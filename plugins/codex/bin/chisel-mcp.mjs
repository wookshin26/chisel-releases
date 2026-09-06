/**
 * Chisel Codex bridge.
 *
 * The local side is an always-available stdio MCP server. The remote side is
 * Chisel's authenticated, loopback-only Streamable HTTP endpoint. Keeping the
 * two lifecycles separate lets Codex initialize while Chisel is closed.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const BRIDGE_VERSION = '1.0.0'
const MAX_DISCOVERY_BYTES = 16 * 1024
const REMOTE_LIST_TIMEOUT_MS = 5_000
const REMOTE_CALL_TIMEOUT_MS = 120_000
/** @modelcontextprotocol/sdk ErrorCode values (types.js) */
const MCP_CONNECTION_CLOSED = -32000
const MCP_REQUEST_TIMEOUT = -32001
const APP_NOT_RUNNING_MESSAGE =
  'Chisel is not running with its MCP server enabled. Open Chisel and enable the MCP server in Settings.'

export class DiscoveryError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DiscoveryError'
  }
}

/**
 * Resolve the discovery location Chisel writes on this OS: the Apple Silicon macOS path (the
 * original v1 contract) or `%APPDATA%\Chisel\mcp.v1.json` on Windows. Each branch uses that
 * platform's own path rules, so the answer does not depend on the host running the bridge.
 */
export function resolveDiscoveryPath({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  home = os.homedir()
} = {}) {
  const override = env.CHISEL_MCP_CONFIG?.trim()
  if (override) return path.resolve(override)
  if (platform === 'darwin') {
    if (arch !== 'arm64') return null
    return path.posix.join(home, 'Library', 'Application Support', 'Chisel', 'mcp.v1.json')
  }
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || path.win32.join(home, 'AppData', 'Roaming')
    return path.win32.join(appData, 'Chisel', 'mcp.v1.json')
  }
  return null
}

/** Everyone, Authenticated Users, BUILTIN\Users, Interactive, Anonymous. */
const BROAD_PRINCIPAL_SIDS = new Map([
  ['S-1-1-0', 'Everyone'],
  ['S-1-5-11', 'Authenticated Users'],
  ['S-1-5-32-545', 'Users'],
  ['S-1-5-4', 'Interactive'],
  ['S-1-5-7', 'Anonymous']
])
const ACL_PATH_ENV = 'CHISEL_ACL_PATH'
// The path travels through an environment variable so directory names can never become
// PowerShell syntax; SIDs (not display names) keep the verdict locale-independent.
const ACL_SCRIPT = [
  `$acl = Get-Acl -LiteralPath $env:${ACL_PATH_ENV}`,
  "'OWNER|' + $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
  '$acl.Access | ForEach-Object {',
  '  $sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value',
  "  'ACE|{0}|{1}|{2}' -f $sid, $_.AccessControlType, $_.FileSystemRights",
  '}'
].join('; ')

/** Pure classification of the `OWNER|sid` / `ACE|sid|type|rights` lines from ACL_SCRIPT. */
export function classifyDiscoveryAcl(lines) {
  let owner = ''
  const broadAccess = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('OWNER|')) {
      owner = line.slice('OWNER|'.length)
      continue
    }
    if (!line.startsWith('ACE|')) continue
    const [, sid = '', type = ''] = line.split('|')
    const broad = BROAD_PRINCIPAL_SIDS.get(sid)
    if (broad && type === 'Allow' && !broadAccess.includes(broad)) broadAccess.push(broad)
  }
  return { owner, broadAccess }
}

/**
 * Windows has no 0600: POSIX mode bits are advisory on NTFS, so the discovery file is private
 * only if its DACL grants nothing to broad groups. The verdict comes from PowerShell's ACL view.
 */
export async function verifyWindowsPrivateFile(configPath) {
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ACL_SCRIPT],
      {
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
        env: { ...process.env, [ACL_PATH_ENV]: configPath }
      },
      (error, out) => (error ? reject(error) : resolve(out))
    )
  })
  const { owner, broadAccess } = classifyDiscoveryAcl(stdout.split(/\r?\n/u))
  if (!owner) throw new DiscoveryError('Chisel MCP discovery permissions could not be verified.')
  if (broadAccess.length > 0) {
    throw new DiscoveryError(
      `Chisel MCP discovery must be private to your Windows account (readable by ${broadAccess.join(', ')}).`
    )
  }
}

/** Read and validate the bearer discovery record without ever logging its token. */
export async function readDiscovery(configPath, options = {}) {
  const platform = options.platform ?? process.platform
  const verifyPrivateFile = options.verifyPrivateFile ?? verifyWindowsPrivateFile
  if (!configPath) {
    throw new DiscoveryError(
      'Chisel MCP discovery supports macOS (Apple Silicon) and Windows only.'
    )
  }
  let stat
  try {
    stat = await fsp.stat(configPath)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw new DiscoveryError('Chisel MCP discovery could not be read.')
  }
  if (!stat.isFile() || stat.size > MAX_DISCOVERY_BYTES) {
    throw new DiscoveryError('Chisel MCP discovery is not a valid bounded file.')
  }
  if (platform === 'win32') {
    try {
      await verifyPrivateFile(configPath)
    } catch (error) {
      if (error instanceof DiscoveryError) throw error
      throw new DiscoveryError('Chisel MCP discovery permissions could not be verified.')
    }
  } else if ((stat.mode & 0o077) !== 0) {
    throw new DiscoveryError('Chisel MCP discovery permissions must be 0600.')
  }

  let parsed
  try {
    parsed = JSON.parse(await fsp.readFile(configPath, 'utf8'))
  } catch {
    throw new DiscoveryError('Chisel MCP discovery contains invalid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1) {
    throw new DiscoveryError('Chisel MCP discovery schema is unsupported.')
  }
  if (parsed.enabled !== true || parsed.port === null) return null
  if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65_535) {
    throw new DiscoveryError('Chisel MCP discovery contains an invalid port.')
  }
  if (typeof parsed.token !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.token)) {
    throw new DiscoveryError('Chisel MCP discovery contains an invalid token.')
  }
  return {
    schemaVersion: 1,
    enabled: true,
    port: parsed.port,
    token: parsed.token,
    startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : null,
    appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : null
  }
}

/**
 * Watch the containing directory because Chisel updates discovery with an
 * atomic rename. A quiet unref'ed poll covers directory creation and rare
 * platform watcher drops.
 */
export function watchDiscoveryFile(
  configPath,
  onChange,
  { debounceMs = 75, pollIntervalMs = 1_000 } = {}
) {
  if (!configPath) return () => {}
  const directory = path.dirname(configPath)
  const filename = path.basename(configPath)
  let watcher = null
  let debounce = null
  let stopped = false

  const schedule = () => {
    if (stopped) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      onChange()
    }, debounceMs)
  }
  const arm = () => {
    if (stopped || watcher) return
    try {
      watcher = fs.watch(directory, (_event, changed) => {
        if (changed === null || changed === filename) schedule()
      })
      watcher.on('error', () => {
        watcher?.close()
        watcher = null
      })
    } catch {
      watcher = null
    }
  }

  arm()
  const poll = setInterval(() => {
    arm()
    schedule()
  }, pollIntervalMs)
  poll.unref?.()

  return () => {
    stopped = true
    if (debounce) clearTimeout(debounce)
    clearInterval(poll)
    watcher?.close()
    watcher = null
  }
}

export async function connectHttpEndpoint(discovery) {
  const client = new Client({ name: 'chisel-codex-bridge', version: BRIDGE_VERSION })
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${discovery.port}/mcp`),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${discovery.token}` }
      }
    }
  )
  try {
    await client.connect(transport, { timeout: REMOTE_LIST_TIMEOUT_MS })
  } catch (error) {
    await client.close().catch(() => {})
    throw error
  }
  return {
    listTools: (params = {}) => client.listTools(params, { timeout: REMOTE_LIST_TIMEOUT_MS }),
    callTool: (params) => client.callTool(params, undefined, { timeout: REMOTE_CALL_TIMEOUT_MS }),
    close: async () => {
      await transport.terminateSession().catch(() => {})
      await client.close().catch(() => {})
    }
  }
}

export function appNotRunningResult() {
  return toolErrorResult('app-not-running', APP_NOT_RUNNING_MESSAGE)
}

export function toolErrorResult(code, message) {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }]
  }
}

/**
 * A dead transport and a slow call are not the same failure. Reporting both as
 * app-not-running tells the model to send the user to Settings while Chisel is
 * running fine, and tearing down a healthy session on a timeout costs a
 * reconnect on every long compile.
 */
export function classifyRemoteFailure(error) {
  const code = typeof error?.code === 'number' ? error.code : null
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (code === MCP_REQUEST_TIMEOUT || /timed out|timeout/i.test(message)) {
    return { code: 'call-timeout', retainConnection: true }
  }
  if (
    code === MCP_CONNECTION_CLOSED ||
    /ECONNREFUSED|ENOENT|ECONNRESET|socket hang up/i.test(message)
  ) {
    return { code: 'app-not-running', retainConnection: false }
  }
  if (/\b(401|403|404)\b/.test(message)) {
    return { code: 'app-not-running', retainConnection: false }
  }
  return { code: 'call-failed', retainConnection: false }
}

export class ChiselBridge {
  constructor({
    configPath = resolveDiscoveryPath(),
    readConfig = readDiscovery,
    watchConfig = watchDiscoveryFile,
    connectRemote = connectHttpEndpoint,
    debug = () => {}
  } = {}) {
    this.configPath = configPath
    this.readConfig = readConfig
    this.watchConfig = watchConfig
    this.connectRemote = connectRemote
    this.debug = debug
    this.remote = null
    this.cachedTools = []
    this.stopWatching = null
    this.operation = Promise.resolve()
    this.closed = false
    this.onToolsChanged = () => {}
  }

  async start() {
    if (this.closed || this.stopWatching) return
    await this.reload()
    this.stopWatching = this.watchConfig(this.configPath, () => {
      void this.reload()
    })
  }

  reload() {
    this.operation = this.operation.then(
      () => this.applyDiscovery(),
      () => this.applyDiscovery()
    )
    return this.operation
  }

  async applyDiscovery() {
    if (this.closed) return
    let discovery
    try {
      discovery = await this.readConfig(this.configPath)
    } catch (error) {
      this.debug(error instanceof Error ? error.message : String(error))
      await this.setOffline()
      return
    }
    if (!discovery) {
      await this.setOffline()
      return
    }
    const key = `${discovery.schemaVersion}:${discovery.port}:${discovery.token}`
    if (this.remote?.key === key) return

    let endpoint
    try {
      endpoint = await this.connectRemote(discovery)
      const listing = await endpoint.listTools({})
      if (!listing || !Array.isArray(listing.tools)) {
        throw new Error('Chisel returned an invalid tools/list result.')
      }
      const previous = this.remote
      this.remote = { key, endpoint }
      this.cachedTools = listing.tools
      await previous?.endpoint.close().catch(() => {})
      this.onToolsChanged()
    } catch (error) {
      this.debug(error instanceof Error ? error.message : String(error))
      await endpoint?.close().catch(() => {})
      await this.setOffline()
    }
  }

  async setOffline() {
    const previous = this.remote
    this.remote = null
    await previous?.endpoint.close().catch(() => {})
  }

  async listTools(params = {}) {
    const current = this.remote
    if (!current) return { tools: this.cachedTools }
    try {
      const result = await current.endpoint.listTools(params)
      this.cachedTools = result.tools
      return result
    } catch (error) {
      await this.invalidate(current, error)
      return { tools: this.cachedTools }
    }
  }

  async callTool(params) {
    const current = this.remote
    if (!current) return appNotRunningResult()
    try {
      return await current.endpoint.callTool(params)
    } catch (error) {
      const failure = classifyRemoteFailure(error)
      if (failure.retainConnection) {
        this.debug(error instanceof Error ? error.message : String(error))
      } else {
        await this.invalidate(current, error)
      }
      if (failure.code === 'app-not-running') return appNotRunningResult()
      return toolErrorResult(
        failure.code,
        failure.code === 'call-timeout'
          ? `Chisel did not answer within ${Math.round(REMOTE_CALL_TIMEOUT_MS / 1000)}s. The app is still running and the operation may still be in progress — do not tell the user Chisel is closed.`
          : `The Chisel MCP call failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async invalidate(current, error) {
    this.debug(error instanceof Error ? error.message : String(error))
    if (this.remote === current) {
      this.remote = null
      await current.endpoint.close().catch(() => {})
      void this.reload()
    }
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.stopWatching?.()
    this.stopWatching = null
    await this.operation.catch(() => {})
    await this.setOffline()
  }
}

export function createBridgeApplication(options = {}) {
  const bridge = new ChiselBridge(options)
  const server = new Server(
    { name: 'chisel', version: BRIDGE_VERSION },
    {
      capabilities: { tools: { listChanged: true } },
      instructions:
        'Connects Codex to the Chisel desktop app. Chisel must be open with its MCP server enabled; edits and runs remain parked for in-app approval.'
    }
  )
  let initialized = false
  server.oninitialized = () => {
    initialized = true
  }
  bridge.onToolsChanged = () => {
    if (initialized) void server.sendToolListChanged().catch(() => {})
  }
  server.setRequestHandler(ListToolsRequestSchema, (request) => bridge.listTools(request.params))
  server.setRequestHandler(CallToolRequestSchema, (request) => bridge.callTool(request.params))

  return {
    bridge,
    server,
    async start(transport) {
      await bridge.start()
      await server.connect(transport)
    },
    async close() {
      await bridge.close()
      await server.close().catch(() => {})
    }
  }
}

export async function main() {
  const debug =
    process.env.CHISEL_MCP_DEBUG === '1' ? (message) => console.error(message) : () => {}
  const application = createBridgeApplication({ debug })
  const shutdown = () => {
    void application.close().finally(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  await application.start(new StdioServerTransport())
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (entry === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

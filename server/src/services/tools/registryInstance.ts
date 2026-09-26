// M6: the one real, shared ToolRegistry instance JennySol's server actually uses in production.
// Every ToolRegistry constructed in this codebase's own tests (M3-M5's `new ToolRegistry()`
// calls) is a fresh, isolated instance on purpose, unrelated to this one — this is the only
// place a `ToolRegistry` is instantiated for real request traffic to use.
//
// A connector is registered here regardless of whether its own configured() is currently true —
// that only affects whether it's usable, not whether it exists. In practice, a request can never
// resolve to a product whose configured() is false anyway: requireProductIdentity's
// verifyServiceToken() call fails first, since a product's shared secret being unset means no
// token for that product could ever have been minted (see serviceToken.ts's
// getSecretForProduct()).
import { ToolRegistry } from "./toolRegistry.js";
import { arenaConnector } from "../productConnectors/arena.js";
import { jennysolConnector } from "../productConnectors/jennysol.js";

export const toolRegistry = new ToolRegistry();
toolRegistry.registerConnector(arenaConnector);
// JENNYSOL-ARCHITECTURE.md §5 — JennySol's own first-party tools, for the Agent Runtime
// (agentRuntime/runtime.ts). "jennysol" is a real product namespace here, same as "arena": an
// AgentRun's identity always carries product: "jennysol" for a run started from JennySol's own
// surface, so this connector's tools are the only ones such a run's identity can ever see.
toolRegistry.registerConnector(jennysolConnector);

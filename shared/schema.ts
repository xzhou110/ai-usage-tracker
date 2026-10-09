import { z } from 'zod';

export const providerIds = ['claude', 'codex', 'cursor'] as const;
export const ProviderIdSchema = z.enum(providerIds);
export type ProviderId = z.infer<typeof ProviderIdSchema>;
export const IsoTimeSchema = z.iso.datetime({ offset: true });
const nonnegative = z.number().finite().nonnegative();
const label = z.string().min(1).max(160);
export const QuotaWindowSchema = z.object({
  key: label, label, kind: z.enum(['quota', 'spend']), scope: z.enum(['personal', 'team', 'unknown']),
  usedPercent: nonnegative.nullable(), used: nonnegative.nullable(), limit: nonnegative.nullable(),
  unit: z.enum(['percent', 'USD', 'requests', 'tokens']).nullable(), resetAt: IsoTimeSchema.nullable(),
  durationMinutes: nonnegative.nullable(), cycleId: z.string().max(200).nullable(), detail: z.string().max(500).nullable(),
}).strict();
export type QuotaWindow = z.infer<typeof QuotaWindowSchema>;
export const ObservationSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/), provider: ProviderIdSchema,
  observedAt: IsoTimeSchema, receivedAt: IsoTimeSchema,
  source: z.enum(['codex-app-server', 'claude-statusline', 'claude-desktop-mod', 'cursor-browser']),
  windows: z.array(QuotaWindowSchema),
}).strict();
export type Observation = z.infer<typeof ObservationSchema>;
export const SettingsSchema = z.object({
  timezone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; } catch { return false; } }, 'Choose a valid timezone.'),
  warningPercent: z.number().finite().min(1).max(100),
  staleAfterMinutes: z.number().int().positive(),
}).strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const defaultSettings: Settings = { timezone: 'America/Los_Angeles', warningPercent: 80, staleAfterMinutes: 15 };
export const MembershipSchema = z.object({
  plan: z.string().trim().max(160).nullable(),
  price: nonnegative.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  billingPeriod: z.enum(['month', 'year', 'unknown']),
}).strict();
export type Membership = z.infer<typeof MembershipSchema>;
export const defaultMembership: Membership = { plan: null, price: null, currency: 'USD', billingPeriod: 'unknown' };
export const ProviderStateSchema = z.object({
  id: ProviderIdSchema, name: z.enum(['Claude', 'Codex', 'Cursor']),
  mode: z.enum(['automatic', 'passive', 'experimental']),
  status: z.enum(['disconnected', 'connecting', 'waiting', 'connected', 'error']),
  enabled: z.boolean(), verified: z.boolean(), observation: ObservationSchema.nullable(),
  freshness: z.enum(['unknown', 'fresh', 'stale']),
  lastAttemptAt: IsoTimeSchema.nullable(), lastSuccessAt: IsoTimeSchema.nullable(), nextRefreshAt: IsoTimeSchema.nullable(),
  message: z.string().max(1000), errorCode: z.string().max(80).nullable(), sourceUrl: z.url(),
  membership: MembershipSchema.default(() => ({ ...defaultMembership })),
}).strict();
export type ProviderState = z.infer<typeof ProviderStateSchema>;
export const UsageActionSchema = z.object({
  id: z.string().min(1).max(500), provider: ProviderIdSchema, windowKey: z.string().nullable(),
  kind: z.enum(['disconnected', 'waiting', 'error', 'stale', 'awaiting-confirmation', 'near-limit', 'exhausted']),
  title: label, description: z.string().max(1000), severity: z.enum(['info', 'warning', 'critical']),
  state: z.enum(['open', 'dismissed', 'resolved']), firstSeenAt: IsoTimeSchema, updatedAt: IsoTimeSchema,
  dismissedAt: IsoTimeSchema.nullable(), resolvedAt: IsoTimeSchema.nullable(),
}).strict();
export type UsageAction = z.infer<typeof UsageActionSchema>;
export const DashboardSnapshotSchema = z.object({
  revision: z.string(), serverTime: IsoTimeSchema, settings: SettingsSchema,
  providers: z.array(ProviderStateSchema), actions: z.array(UsageActionSchema),
}).strict();
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;
export const StateSchema = z.object({version:z.literal(1), settings:SettingsSchema, providers:z.array(ProviderStateSchema), actions:z.array(UsageActionSchema)}).strict();
export type StoredState = z.infer<typeof StateSchema>;
export interface HistoryPage { observations: Observation[]; nextCursor: string | null }
export interface ProviderOperation { provider: ProviderId; accepted: boolean; message: string }
export interface ApiError { error: { code: string; message: string } }

export const providerDefinitions = {
  claude: { name: 'Claude', mode: 'passive', sourceUrl: 'https://claude.ai/settings/usage', message: 'Connect the Claude Code bridge to receive quota during normal use. Desktop Code requires the local mod.' },
  codex: { name: 'Codex', mode: 'automatic', sourceUrl: 'https://chatgpt.com/codex/settings/usage', message: 'Connect your installed Codex account for automatic quota updates.' },
  cursor: { name: 'Cursor', mode: 'experimental', sourceUrl: 'https://cursor.com/dashboard?tab=usage', message: 'Pair the Cursor browser extension in Connection Details. Sign in only in your normal browser.' },
} as const;
export function initialState(): StoredState {
  return { version:1, settings:{...defaultSettings}, actions:[], providers:providerIds.map(id => ({
    id, ...providerDefinitions[id], status:'disconnected', enabled:false, verified:false, observation:null,
    freshness:'unknown', lastAttemptAt:null, lastSuccessAt:null, nextRefreshAt:null, errorCode:null,
    membership: { ...defaultMembership },
  })) };
}

export interface ConnectorResult { observation: Observation | null; message: string; waiting?: boolean; verified?: boolean }
export interface ProviderConnector {
  connect(): Promise<ConnectorResult>;
  refresh(): Promise<ConnectorResult>;
  disconnect(): Promise<void>;
  close(): Promise<void>;
}
export type Connectors = Record<ProviderId, ProviderConnector>;

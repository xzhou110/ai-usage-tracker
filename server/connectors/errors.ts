/** Only construct this with fixed, audited text. Never pass native error messages. */
export class ConnectorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'ConnectorError'; this.code = code; }
}

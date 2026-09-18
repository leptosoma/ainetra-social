export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "VALIDATION_ERROR"
      | "CONFLICT",
  ) {
    super(message);
    this.name = "DomainError";
  }
}

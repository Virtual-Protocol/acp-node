class AcpError extends Error {
  constructor(message: string, originalError?: unknown) {
    super();
    this.message = message;
    this.name = "AcpError";

    if (
      originalError &&
      typeof originalError === "object" &&
      "stack" in originalError
    ) {
      this.stack += `\nCaused by: ${originalError.stack}`;
    }

    Object.setPrototypeOf(this, AcpError.prototype);
  }
}

export default AcpError;

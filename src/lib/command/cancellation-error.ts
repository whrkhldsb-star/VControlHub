export class CommandCancellationUnconfirmedError extends Error {
  constructor() {
    super("The remote Agent did not acknowledge cancellation; inspect the remote process before retrying");
    this.name = "CommandCancellationUnconfirmedError";
  }
}

// Long if/else-if chain should not be reported by switch-statement-check.
class StatusIfElseRenderer {
  render(status: string): string {
    if (status === "init") {
      return "Initializing";
    } else if (status === "error") {
      return "Error";
    } else if (status === "cancelled") {
      return "Cancelled";
    } else {
      if (status === "loading") {
        return "Loading";
      }
      if (status === "success") {
        return "Success";
      } else {
        if (status === "pending") {
          return "Pending";
        } else if (status === "timeout") {
          return "Timeout";
        }
      }
      return "Unknown";
    }
  }
}

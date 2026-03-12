class StatusRenderer {
  render(status: string): string {
    switch (status) {
      case "init":
        return "Init";
      case "loading":
        return "Loading";
      case "success":
        return "Success";
      case "empty":
        return "Empty";
      case "error":
        return "Error";
      case "cancelled":
        return "Cancelled";
      default:
        return "Unknown";
    }
  }
}

// Smaller switch should stay below阈值
class SmallSwitchRenderer {
  render(kind: string): string {
    switch (kind) {
      case "a":
        return "A";
      case "b":
        return "B";
      default:
        return "Other";
    }
  }
}

// Long if/else-if chain should be reported by switch-statement-check.
class StatusIfElseRenderer {
  render(status: string): string {
    if (status === "init") { return "Init"; } else if (status === "loading") {return "Loading";} else if (status === "success") {  return "Success";} else if (status === "empty") {  return "Empty";} else if (status === "error") {  return "Error";} else if (status === "cancelled") {  return "Cancelled";} else {  return "Unknown";}
  }
}

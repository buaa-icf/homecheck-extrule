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

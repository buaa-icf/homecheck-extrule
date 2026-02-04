// Switch statement clean variant using strategy map

class StatusStrategy {
  constructor(private label: string) {}
  render(): string {
    return this.label;
  }
}

class StatusRendererOptimized {
  private strategies: Record<string, StatusStrategy> = {
    init: new StatusStrategy("Init"),
    loading: new StatusStrategy("Loading"),
    success: new StatusStrategy("Success"),
    empty: new StatusStrategy("Empty"),
    error: new StatusStrategy("Error"),
    cancelled: new StatusStrategy("Cancelled")
  };

  render(status: string): string {
    const strategy = this.strategies[status];
    return strategy ? strategy.render() : "Unknown";
  }
}

// Large switch to trigger the detector (6 cases + default).
class StatusRendererLegacy {
  render(status: string): string {
    switch (status) {
      case "init":
        return "Init";
      case "loading":
        return "Loading";
      case "success":
        return "Success";
      case "empty": {
        const label = "Empty";
        return `${label}-${status}`;
      }
      case "error": {
        const msg = `Error:${status}`;
        this.log(msg);
        return msg;
      }
      case "cancelled": {
        const detail = `${status}-detail`;
        const report = `${detail}-report`;
        return report;
      }
      default:
        return "Unknown";
    }
  }

  private log(msg: string): void {
    // no-op for sample; used to increase case body length
  }
}

// Small switch variant stays below threshold and should not be flagged.
class SmallSwitchRendererSafe {
  render(kind: string): string {
    switch (kind) {
      case "x":
        return "X";
      case "y":
        return "Y";
      default:
        return "Other";
    }
  }
}

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

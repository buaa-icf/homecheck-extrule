// Feature Envy sample

class InventoryClient {
  getStock(id: string): number {
    return id.length;
  }

  reserve(id: string, qty: number): boolean {
    return qty > 0 && id.length > 0;
  }

  release(id: string): void {}
}

// ========== 策略接口与实现 ==========
interface OrderFulfillmentStrategy {
  fulfill(orderId: string, qty: number): boolean;
}

class StockFirstStrategy implements OrderFulfillmentStrategy {
  constructor(private inventory: InventoryClient) {}

  fulfill(orderId: string, qty: number): boolean {
    const available = this.inventory.getStock(orderId);
    const reserved = this.inventory.reserve(orderId, qty);
    if (!reserved) {
      return false;
    }
    if (available < qty) {
      this.inventory.release(orderId);
      return false;
    }
    return true;
  }
}

class ReserveOnlyStrategy implements OrderFulfillmentStrategy {
  constructor(private inventory: InventoryClient) {}

  fulfill(orderId: string, qty: number): boolean {
    return this.inventory.reserve(orderId, qty);
  }
}
// ========== 策略接口与实现结束 ==========

class OrderService {
  private inventory: InventoryClient = new InventoryClient();

  // 通过策略表选择不同履约策略，避免服务对 InventoryClient 的过度依赖。
  private strategies: Record<string, OrderFulfillmentStrategy> = {
    default: new StockFirstStrategy(this.inventory),
    preorder: new ReserveOnlyStrategy(this.inventory)
  };

  processOrder(orderId: string, qty: number, mode: string = "default"): boolean {
    const strategy = this.strategies[mode] ?? this.strategies.default;
    return strategy.fulfill(orderId, qty);
  }

  calculateFee(qty: number, price: number): number {
    if (qty <= 0 || price < 0) {
      return 0;
    }
    const subtotal = qty * price;
    const serviceFee = 5;
    return subtotal + serviceFee;
  }
}

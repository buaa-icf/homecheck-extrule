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

class OrderService {
  private inventory: InventoryClient = new InventoryClient();

  // This method heavily depends on InventoryClient and should trigger Feature Envy.
  processOrder(orderId: string, qty: number): boolean {
    const available = this.inventory.getStock(orderId);
    const reserved = this.inventory.reserve(orderId, qty);
    if (!reserved) {
      return false;
    }
    if (available < qty) {
      this.inventory.release(orderId);
      return false;
    }
    // Self interaction is minimal compared to inventory calls.
    return true;
  }

  // Safe method that uses mainly its own logic; should not trigger.
  calculateFee(qty: number, price: number): number {
    if (qty <= 0 || price < 0) {
      return 0;
    }
    const subtotal = qty * price;
    const serviceFee = 5;
    return subtotal + serviceFee;
  }
}

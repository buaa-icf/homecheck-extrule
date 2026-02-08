// Feature Envy smelly variant: service heavily using external gateway

class PaymentGateway {
  fetchLimit(userId: string): number {
    return userId.length * 100;
  }

  charge(userId: string, amount: number): boolean {
    return amount > 0 && userId.length > 0;
  }

  refund(userId: string, amount: number): void {}
}

class BillingService {
  private gateway: PaymentGateway = new PaymentGateway();

  // Deliberately chatty with gateway to trigger Feature Envy.
  settle(userId: string, amount: number): boolean {
    const limit = this.gateway.fetchLimit(userId);
    if (limit < amount) {
      return false;
    }
    const charged = this.gateway.charge(userId, amount);
    if (!charged) {
      return false;
    }
    if (amount > limit / 2) {
      this.gateway.refund(userId, amount / 2);
    }
    this.gateway.refund(userId, 0); // extra call to emphasize reliance
    return true;
  }

  // Mostly self-contained logic; should not trigger.
  localDiscount(amount: number): number {
    if (amount <= 0) {
      return 0;
    }
    const rate = amount > 200 ? 0.9 : 0.95;
    return amount * rate;
  }
}

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

class ExternalUserInfo {
  id: string = '';
  nickName: string = '';
  avatarUrl: string = '';
  totalReading: number = 0;
  bookCoins: number = 0;
}

class UserInfoModel {
  id: string = '';
  nickName: string = '';
  avatarUrl: string = '';
  totalReading: number = 0;
  bookCoins: number = 0;

  updateFromUserInfo(userInfo: ExternalUserInfo | undefined): void {
    if (!userInfo) {
      return;
    }

    this.id = userInfo.id;
    this.nickName = userInfo.nickName;
    this.avatarUrl = userInfo.avatarUrl;
    this.totalReading = userInfo.totalReading;
    this.bookCoins = userInfo.bookCoins;
  }
}

class PrimitiveFormatter {
  phone: string | boolean = '';
  isLogin: boolean | string = false;

  maskPhone(): void {
    if (this.phone) {
      this.phone =
        `${this.phone.substring(0, this.phone.length - 8)}****${this.phone.substring(this.phone.length - 4)}`;
    }

    this.isLogin = !!this.phone;
  }
}

class BuilderOption {
  type: 'primary' | 'secondary' = 'primary';
}

@Builder
function primaryCard(option: BuilderOption) {
  let label = option.type;
}

@Builder
function secondaryCard(option: BuilderOption) {
  let label = option.type;
}

@Builder
function cardSelector(option: BuilderOption) {
  if (option.type === 'primary') {
    primaryCard(option);
  } else {
    secondaryCard(option);
  }
}

class DialogAction {
  reason: number = 0;

  dismiss(): void {}
}

class DialogHost {
  openCustom(handler: (action: DialogAction) => void): void {}
}

class DialogController {
  private host: DialogHost = new DialogHost();

  registerDismissHandler(): void {
    this.host.openCustom((dismissDialogAction: DialogAction) => {
      if (dismissDialogAction.reason === 1) {
        dismissDialogAction.dismiss();
      }
      if (dismissDialogAction.reason === 2) {
        dismissDialogAction.dismiss();
      }
      if (dismissDialogAction.reason === 3) {
        dismissDialogAction.dismiss();
      }
    });
  }
}

class PaymentPayload {
  partnerId: string = '';
  appId: string = '';
  packageValue: string = '';
  prepayId: string = '';
  nonceStr: string = '';
}

class PaymentRequest {
  partnerId: string = '';
  appId: string = '';
  packageValue: string = '';
  prepayId: string = '';
  nonceStr: string = '';

  send(context: string): void {}
}

class PaymentAdapter {
  submitPayment(payload: PaymentPayload, context: string): void {
    let req = new PaymentRequest();
    req.partnerId = payload.partnerId;
    req.appId = payload.appId;
    req.packageValue = payload.packageValue;
    req.prepayId = payload.prepayId;
    req.nonceStr = payload.nonceStr;
    req.send(context);
  }
}

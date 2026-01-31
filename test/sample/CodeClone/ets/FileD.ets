// FileD.ets - Type2 克隆测试：原始版本

@Component
struct OrderPage {
  @State orderList: number[] = []

  build() {
    Column() {
      Text("订单页面")
        .fontSize(20)
    }
  }

  // ========== Type2 克隆代码块 开始 ==========
  // 这段代码在 FileE.ets 中结构相同，但变量名/函数名不同
  
  // 方法1：计算总价
  calculateTotal(items: number[]): number {
    let total = 0
    for (let i = 0; i < items.length; i++) {
      let item = items[i]
      if (item > 0) {
        total = total + item
      }
    }
    return total
  }

  // 方法2：格式化显示
  formatDisplay(value: number): string {
    let formatted = value.toFixed(2)
    let result = "价格: " + formatted
    return result
  }

  // 方法3：检查有效性
  checkValidity(input: string): boolean {
    if (input.length === 0) {
      return false
    }
    if (input.length > 50) {
      return false
    }
    let trimmed = input.trim()
    if (trimmed.length === 0) {
      return false
    }
    return true
  }
  // ========== Type2 克隆代码块 结束 ==========

  // 独特方法
  uniqueOrderMethod(): void {
    console.log("Order specific logic")
  }
}

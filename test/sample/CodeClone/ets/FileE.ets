// FileE.ets - Type2 克隆测试：变量名不同但结构相同

@Component
struct CartPage {
  @State cartItems: number[] = []

  build() {
    Column() {
      Text("购物车页面")
        .fontSize(18)
    }
  }

  // ========== Type2 克隆代码块 开始 ==========
  // 这段代码与 FileD.ets 结构相同，但变量名/函数名不同（Type2 克隆）
  
  // 方法1：计算总和（对应 FileD 的 calculateTotal）
  computeSum(data: number[]): number {
    let result = 0
    for (let j = 0; j < data.length; j++) {
      let element = data[j]
      if (element > 0) {
        result = result + element
      }
    }
    return result
  }

  // 方法2：格式化输出（对应 FileD 的 formatDisplay）
  formatOutput(num: number): string {
    let str = num.toFixed(2)
    let output = "价格: " + str
    return output
  }

  // 方法3：验证输入（对应 FileD 的 checkValidity）
  validateInput(text: string): boolean {
    if (text.length === 0) {
      return false
    }
    if (text.length > 50) {
      return false
    }
    let cleaned = text.trim()
    if (cleaned.length === 0) {
      return false
    }
    return true
  }
  // ========== Type2 克隆代码块 结束 ==========

  // 独特方法
  uniqueCartMethod(): void {
    console.log("Cart specific logic")
  }
}

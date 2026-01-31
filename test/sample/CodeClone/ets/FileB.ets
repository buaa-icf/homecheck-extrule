// FileB.ets - 包含与 FileA 相同的 Type1 克隆代码

@Component
struct PageB {
  @State title: string = "页面B"
  @State value: number = 100

  build() {
    Column() {
      Text(this.title)
        .fontSize(20)
      
      Button("减少")
        .onClick(() => {
          this.value--
        })
    }
  }

  // ========== Type1 克隆代码块 开始 ==========
  // 这段代码与 FileA.ets 中完全相同（Type1 克隆）
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

  formatPrice(price: number): string {
    let formatted = price.toFixed(2)
    let result = "¥" + formatted
    return result
  }

  validateInput(input: string): boolean {
    if (input.length === 0) {
      return false
    }
    if (input.length > 100) {
      return false
    }
    return true
  }
  // ========== Type1 克隆代码块 结束 ==========

  // 这个方法是独特的，不是克隆
  uniqueMethodB(): void {
    console.log("This is unique to FileB")
  }
}

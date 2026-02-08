// ============================================================
// @file: ClassB.ets
// @category: positive/fragment_different_class
// @expect: fragment-clone with ClassA.ets
// @clone-type: Fragment (不同类之间)
// @scope: DIFFERENT_CLASS
// @description: 与 ClassA.ets 存在重复的代码片段
// ============================================================

@Component
struct ProductValidator {
    @State products: string[] = []
    @State isValid: boolean = false

    build() {
        Column() {
            Text("产品验证器")
                .fontSize(24)
            Button("验证")
                .onClick(() => {
                    this.validateProducts()
                })
        }
    }

    /**
     * 验证产品数据
     * 这段验证逻辑与 ClassA.ets 中的 validateUsers 相同
     */
    validateProducts(): boolean {
        let items = this.products
        
        // ========== 跨文件重复片段 ==========
        // 这段代码与 ClassA.ets 中的完全相同
        let validCount = 0
        let errorMessages: string[] = []
        let processedItems: string[] = []
        
        for (let i = 0; i < items.length; i++) {
            let item = items[i]
            let trimmed = item.trim()
            
            if (trimmed.length === 0) {
                errorMessages.push("空字符串")
                continue
            }
            
            if (trimmed.length < 3) {
                errorMessages.push("太短: " + trimmed)
                continue
            }
            
            if (trimmed.length > 50) {
                errorMessages.push("太长: " + trimmed)
                continue
            }
            
            processedItems.push(trimmed)
            validCount = validCount + 1
        }
        
        let successRate = items.length > 0 ? validCount / items.length : 0
        console.log("成功率: " + successRate.toString())
        console.log("错误数: " + errorMessages.length.toString())
        // ========== 跨文件重复片段结束 ==========

        this.isValid = errorMessages.length === 0
        return this.isValid
    }
}

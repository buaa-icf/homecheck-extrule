// ============================================================
// @file: InterMethodClone.ets
// @category: positive/fragment_same_class
// @expect: fragment-clone between methods in same class
// @clone-type: Fragment (同一类不同方法重复)
// @scope: SAME_CLASS
// @description: 同一个类的不同方法之间存在重复的代码片段
// ============================================================

@Component
struct OrderManager {
    @State orders: number[] = []
    @State total: number = 0

    build() {
        Column() {
            Text("订单管理器")
                .fontSize(24)
            Button("计算")
                .onClick(() => {
                    this.calculateOrderTotal()
                })
        }
    }

    /**
     * 方法1: 计算订单总额
     * 包含与 validateOrderData 相同的验证逻辑
     */
    calculateOrderTotal(): number {
        let items = this.orders
        
        // ========== 重复片段开始 ==========
        let validItems: number[] = []
        let invalidCount = 0
        let totalProcessed = 0
        
        for (let i = 0; i < items.length; i++) {
            let item = items[i]
            totalProcessed = totalProcessed + 1
            
            if (item <= 0) {
                invalidCount = invalidCount + 1
                continue
            }
            
            if (item > 10000) {
                invalidCount = invalidCount + 1
                continue
            }
            
            validItems.push(item)
        }
        
        let validRate = totalProcessed > 0 ? validItems.length / totalProcessed : 0
        console.log("有效率: " + validRate.toString())
        console.log("无效数量: " + invalidCount.toString())
        // ========== 重复片段结束 ==========

        // 计算总额（这部分是独特的）
        let sum = 0
        for (let i = 0; i < validItems.length; i++) {
            sum = sum + validItems[i]
        }
        
        this.total = sum
        return sum
    }

    /**
     * 方法2: 验证订单数据
     * 包含与 calculateOrderTotal 相同的验证逻辑
     */
    validateOrderData(): boolean {
        let items = this.orders
        
        // ========== 重复片段开始 ==========
        // 这段代码与上面方法中的片段完全相同
        let validItems: number[] = []
        let invalidCount = 0
        let totalProcessed = 0
        
        for (let i = 0; i < items.length; i++) {
            let item = items[i]
            totalProcessed = totalProcessed + 1
            
            if (item <= 0) {
                invalidCount = invalidCount + 1
                continue
            }
            
            if (item > 10000) {
                invalidCount = invalidCount + 1
                continue
            }
            
            validItems.push(item)
        }
        
        let validRate = totalProcessed > 0 ? validItems.length / totalProcessed : 0
        console.log("有效率: " + validRate.toString())
        console.log("无效数量: " + invalidCount.toString())
        // ========== 重复片段结束 ==========

        // 返回验证结果（这部分是独特的）
        return invalidCount === 0
    }

    // 独特方法，不参与克隆
    getOrderCount(): number {
        return this.orders.length
    }
}

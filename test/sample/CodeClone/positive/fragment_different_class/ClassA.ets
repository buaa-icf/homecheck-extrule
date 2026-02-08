// ============================================================
// @file: ClassA.ets
// @category: positive/fragment_different_class
// @expect: fragment-clone with ClassB.ets and TopLevelFunc.ets
// @clone-type: Fragment (不同类之间 / 类与函数之间)
// @scope: DIFFERENT_CLASS
// @description: 与其他文件中的类/函数存在重复的代码片段
// ============================================================

@Component
struct UserValidator {
    @State users: string[] = []
    @State isValid: boolean = false

    build() {
        Column() {
            Text("用户验证器")
                .fontSize(24)
            Button("验证")
                .onClick(() => {
                    this.validateUsers()
                })
        }
    }

    /**
     * 验证用户数据
     * 这段验证逻辑在 ClassB.ets 和 TopLevelFunc.ets 中也存在
     */
    validateUsers(): boolean {
        let items = this.users
        
        // ========== 跨文件重复片段 ==========
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

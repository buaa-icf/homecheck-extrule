// ============================================================
// @file: TopLevelFunc.ets
// @category: positive/fragment_different_class
// @expect: fragment-clone with ClassA.ets
// @clone-type: Fragment (类与独立函数之间)
// @scope: DIFFERENT_CLASS
// @description: 独立函数与类方法存在重复的代码片段
// ============================================================

/**
 * 顶级函数：验证数据
 * 这段验证逻辑与 ClassA.ets 中的 validateUsers 相同
 */
function validateData(items: string[]): boolean {
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

    return errorMessages.length === 0
}

/**
 * 另一个顶级函数
 * 不参与克隆
 */
function helperFunction(): void {
    console.log("This is a helper")
}

// 导出函数
export { validateData, helperFunction }

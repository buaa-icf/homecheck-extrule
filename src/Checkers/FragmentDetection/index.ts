/**
 * FragmentDetection 模块
 * 
 * 代码片段级克隆检测的核心组件
 */

// Token 相关
export { Token, TokenType, createToken, isKeyword, isIdentifier, isLiteral } from './Token';

// 滑动窗口
export { TokenWindow, createSlidingWindows, getWindowCount } from './SlidingWindow';

// 哈希索引
export {
    FragmentLocation,
    HashIndex,
    computeWindowHash,
    computeTokensHash,
    computeFingerprint,
    createLocationFromWindow
} from './HashIndex';

export { djb2Hash } from '../utils';

// 克隆匹配器
export { CloneMatch, ClonePair, CloneMatcher } from './CloneMatcher';

// 克隆合并器
export {
    MergedClone,
    isConsecutive,
    createMergedClone,
    extendMergedClone,
    mergeClonePairs,
    CloneMerger
} from './CloneMerger';

export { UnionFind } from './UnionFind';

export { CloneClass, CloneClassMember, classifyClones } from './CloneClassifier';

// 滚动哈希
export { RollingHash } from './RollingHash';

// Tokenizer - ArkTS 词法分析器
export {
    TokenizerOptions,
    Tokenizer,
    tokenize,
    tokenizeNormalized,
    mapSyntaxKindToTokenType,
    offsetToLineColumn
} from './Tokenizer';

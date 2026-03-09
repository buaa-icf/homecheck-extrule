import { ForEachArgsCheck } from "./ForEachArgsCheck";
import { LongMethodCheck } from "./LongMethodCheck";
import { CodeCloneType1Check } from "./CodeCloneType1Check";
import { CodeCloneType2Check } from "./CodeCloneType2Check";
import { CodeCloneFragmentCheck } from "./CodeCloneFragmentCheck";
import { FeatureEnvyCheck } from "./FeatureEnvyCheck";
import { SwitchStatementCheck } from "./SwitchStatementCheck";
import { AdviceChecker, BaseChecker } from "homecheck";

type CheckerClass = new () => BaseChecker | AdviceChecker;

const fileCheckerRegistry: Array<[string, CheckerClass]> = [
    ["@extrulesproject/foreach-args-check", ForEachArgsCheck],
    ["@extrulesproject/long-method-check", LongMethodCheck],
    ["@extrulesproject/feature-envy-check", FeatureEnvyCheck],
    ["@extrulesproject/switch-statement-check", SwitchStatementCheck]
];

const projectCheckerRegistry: Array<[string, CheckerClass]> = [
    ["@extrulesproject/code-clone-type1-check", CodeCloneType1Check],
    ["@extrulesproject/code-clone-type2-check", CodeCloneType2Check],
    ["@extrulesproject/code-clone-fragment-check", CodeCloneFragmentCheck]
];

// 新增文件级的checker，需要在此处注册
export const file2CheckRuleMap: Map<string, CheckerClass> = new Map(fileCheckerRegistry);

// 新增项目级checker，需要在此处注册（克隆检测需要跨文件比较）
export const project2CheckRuleMap: Map<string, CheckerClass> = new Map(projectCheckerRegistry);

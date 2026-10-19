import { z } from "zod";

export const SkillSchema = z.enum([
  "stealth",
  "athletics",
  "persuasion",
  "perception",
  "intimidation",
  "deception",
]);
export type Skill = z.infer<typeof SkillSchema>;
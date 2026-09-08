import type { ComplianceRule } from '@shared/types';
import { getDb, mutate } from './storage';
import * as api from './api';

export function listRules(): ComplianceRule[] {
  return getDb().rules;
}

export function activeRules(): ComplianceRule[] {
  return getDb().rules.filter((r) => r.active);
}

export function toggleRule(ruleId: string, active: boolean, actor: string) {
  const updatedAt = new Date().toISOString();
  mutate(
    (draft) => {
      const rule = draft.rules.find((r) => r.id === ruleId);
      if (!rule) return;
      rule.active = active;
      rule.updatedAt = updatedAt;
      rule.updatedBy = actor;
    },
    () => api.patchRule(ruleId, { active, updatedAt, updatedBy: actor }),
  );
}

export function updateRule(ruleId: string, patch: Partial<ComplianceRule>, actor: string) {
  const updatedAt = new Date().toISOString();
  mutate(
    (draft) => {
      const rule = draft.rules.find((r) => r.id === ruleId);
      if (!rule) return;
      Object.assign(rule, patch);
      rule.updatedAt = updatedAt;
      rule.updatedBy = actor;
    },
    () => api.patchRule(ruleId, { ...patch, updatedAt, updatedBy: actor }),
  );
}

export function updateRuleParam(ruleId: string, key: string, value: number | string, actor: string) {
  const updatedAt = new Date().toISOString();
  const params = { ...(getDb().rules.find((r) => r.id === ruleId)?.params ?? {}), [key]: value };
  mutate(
    (draft) => {
      const rule = draft.rules.find((r) => r.id === ruleId);
      if (!rule) return;
      rule.params = params;
      rule.updatedAt = updatedAt;
      rule.updatedBy = actor;
    },
    () => api.patchRule(ruleId, { params, updatedAt, updatedBy: actor }),
  );
}

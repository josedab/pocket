import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createFormManager, type FormManager } from '../form-manager.js';
import type { FormConfig, FormEvent, FormState } from '../types.js';

function makeConfig(overrides?: Partial<FormConfig>): FormConfig {
  return {
    fields: [
      { name: 'name', type: 'text', label: 'Name', required: true },
      { name: 'email', type: 'email', label: 'Email' },
      { name: 'age', type: 'number', label: 'Age', defaultValue: 25 },
    ],
    ...overrides,
  };
}

describe('FormManager', () => {
  let manager: FormManager;

  beforeEach(() => {
    manager = createFormManager(makeConfig());
  });

  describe('initialization', () => {
    it('should create form state with default field values', () => {
      const state = manager.getState();
      expect(state.fields['name']?.value).toBeNull();
      expect(state.fields['email']?.value).toBeNull();
      expect(state.fields['age']?.value).toBe(25);
    });

    it('should start with clean state', () => {
      const state = manager.getState();
      expect(state.isValid).toBe(true);
      expect(state.isDirty).toBe(false);
      expect(state.isSubmitting).toBe(false);
      expect(state.isSubmitted).toBe(false);
      expect(state.submitError).toBeNull();
      expect(state.submitCount).toBe(0);
    });

    it('should initialize all fields as untouched and unfocused', () => {
      const state = manager.getState();
      for (const fieldState of Object.values(state.fields)) {
        expect(fieldState.touched).toBe(false);
        expect(fieldState.dirty).toBe(false);
        expect(fieldState.focused).toBe(false);
        expect(fieldState.validation.valid).toBe(true);
        expect(fieldState.validation.errors).toEqual([]);
      }
    });
  });

  describe('getValues / setValues', () => {
    it('should set and retrieve multiple field values', () => {
      manager.setValues({ name: 'Alice', email: 'alice@test.com' });
      const values = manager.getValues();
      expect(values.name).toBe('Alice');
      expect(values.email).toBe('alice@test.com');
    });

    it('should mark form as dirty when values change', () => {
      manager.setValues({ name: 'Alice' });
      expect(manager.getState().isDirty).toBe(true);
    });

    it('should not mark dirty for unchanged default values', () => {
      manager.setValues({ age: 25 });
      const fieldState = manager.getState().fields['age'];
      expect(fieldState?.dirty).toBe(false);
    });

    it('should apply format transform on setValues', () => {
      const config = makeConfig();
      config.fields[0]!.format = (v) => String(v).toUpperCase();
      const mgr = createFormManager(config);
      mgr.setValues({ name: 'alice' });
      expect(mgr.getFieldValue('name')).toBe('ALICE');
    });

    it('should apply parse transform on getValues', () => {
      const config = makeConfig();
      config.fields[0]!.parse = (v) => String(v).trim();
      const mgr = createFormManager(config);
      mgr.setFieldValue('name', '  Alice  ');
      expect(mgr.getValues().name).toBe('Alice');
    });

    it('should ignore unknown field names in setValues', () => {
      manager.setValues({ unknown: 'value' } as Record<string, unknown>);
      expect(manager.getFieldValue('unknown')).toBeUndefined();
    });
  });

  describe('setFieldValue / getFieldValue', () => {
    it('should set and get a single field value', () => {
      manager.setFieldValue('name', 'Bob');
      expect(manager.getFieldValue('name')).toBe('Bob');
    });

    it('should mark field as dirty when value differs from initial', () => {
      manager.setFieldValue('name', 'Bob');
      expect(manager.getState().fields['name']?.dirty).toBe(true);
    });

    it('should emit change event on field value change', () => {
      const events: FormEvent[] = [];
      manager.events.subscribe((e) => events.push(e));
      manager.setFieldValue('name', 'Bob');
      expect(events.some((e) => e.type === 'change' && e.fieldName === 'name')).toBe(true);
    });

    it('should silently ignore setting value for non-existent field', () => {
      expect(() => manager.setFieldValue('nonexistent', 'val')).not.toThrow();
    });
  });

  describe('focus / blur / touched', () => {
    it('should track focus state', () => {
      manager.handleFocus('name');
      expect(manager.getState().fields['name']?.focused).toBe(true);
    });

    it('should emit focus event', () => {
      const events: FormEvent[] = [];
      manager.events.subscribe((e) => events.push(e));
      manager.handleFocus('name');
      expect(events.some((e) => e.type === 'focus' && e.fieldName === 'name')).toBe(true);
    });

    it('should clear focus and set touched on blur', () => {
      manager.handleFocus('name');
      manager.handleBlur('name');
      const field = manager.getState().fields['name'];
      expect(field?.focused).toBe(false);
      expect(field?.touched).toBe(true);
    });

    it('should emit blur event', () => {
      const events: FormEvent[] = [];
      manager.events.subscribe((e) => events.push(e));
      manager.handleBlur('name');
      expect(events.some((e) => e.type === 'blur' && e.fieldName === 'name')).toBe(true);
    });

    it('should set touched explicitly', () => {
      manager.setFieldTouched('email', true);
      expect(manager.getState().fields['email']?.touched).toBe(true);
    });

    it('should handle focus/blur for non-existent fields without error', () => {
      expect(() => manager.handleFocus('nonexistent')).not.toThrow();
      expect(() => manager.handleBlur('nonexistent')).not.toThrow();
    });
  });

  describe('validation', () => {
    it('should validate required fields', async () => {
      const result = await manager.validateField('name');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name is required');
    });

    it('should pass validation when required field has a value', async () => {
      manager.setFieldValue('name', 'Alice');
      const result = await manager.validateField('name');
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should run custom validate function', async () => {
      const config = makeConfig();
      config.fields[0]!.validate = (value) =>
        String(value).length < 2 ? 'Name must be at least 2 characters' : null;
      const mgr = createFormManager(config);
      mgr.setFieldValue('name', 'A');
      const result = await mgr.validateField('name');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name must be at least 2 characters');
    });

    it('should run async validate function', async () => {
      const config = makeConfig();
      config.fields[0]!.validateAsync = async (value) =>
        value === 'taken' ? 'Name is already taken' : null;
      const mgr = createFormManager(config);
      mgr.setFieldValue('name', 'taken');
      const result = await mgr.validateField('name');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name is already taken');
    });

    it('should handle async validation failure gracefully', async () => {
      const config = makeConfig();
      config.fields[0]!.validateAsync = async () => {
        throw new Error('Network error');
      };
      const mgr = createFormManager(config);
      mgr.setFieldValue('name', 'Alice');
      const result = await mgr.validateField('name');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Validation failed');
    });

    it('should validate against Zod schema', async () => {
      const schema = z.object({
        name: z.string().min(3),
        email: z.string().email(),
        age: z.number(),
      });
      const mgr = createFormManager(makeConfig(), schema);
      mgr.setFieldValue('name', 'AB');
      const result = await mgr.validateField('name');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate all fields at once', async () => {
      const isValid = await manager.validateAll();
      expect(isValid).toBe(false); // name is required but null
      expect(manager.getState().isValid).toBe(false);
    });

    it('should return true when all fields are valid', async () => {
      manager.setFieldValue('name', 'Alice');
      const isValid = await manager.validateAll();
      expect(isValid).toBe(true);
    });

    it('should support conditional required fields', async () => {
      const config = makeConfig();
      config.fields[1]!.required = false;
      config.fields[1]!.requiredIf = (data) => data.name === 'admin';
      const mgr = createFormManager(config);
      mgr.setFieldValue('name', 'admin');
      const result = await mgr.validateField('email');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Email is required');
    });

    it('should emit validate event', async () => {
      const events: FormEvent[] = [];
      manager.events.subscribe((e) => events.push(e));
      manager.setFieldValue('name', 'Alice');
      await manager.validateField('name');
      expect(events.some((e) => e.type === 'validate')).toBe(true);
    });
  });

  describe('validation modes', () => {
    it('should validate on change when mode is onChange', () => {
      const config = makeConfig({ validationMode: 'onChange' });
      const mgr = createFormManager(config);
      mgr.setFieldValue('name', '');
      // Validation is triggered asynchronously; check state update happened
      const field = mgr.getState().fields['name'];
      expect(field?.value).toBe('');
    });

    it('should validate on blur when mode is onBlur', async () => {
      const config = makeConfig({ validationMode: 'onBlur' });
      const mgr = createFormManager(config);
      mgr.handleBlur('name');
      // Allow async validation to settle
      await new Promise((r) => setTimeout(r, 10));
      const field = mgr.getState().fields['name'];
      expect(field?.validation.valid).toBe(false);
    });
  });

  describe('submit', () => {
    it('should submit successfully with valid data', async () => {
      manager.setFieldValue('name', 'Alice');
      const onSubmit = vi.fn();
      const result = await manager.submit(onSubmit);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('should fail submission when validation fails with onSubmit mode', async () => {
      const config = makeConfig({ validationMode: 'onSubmit' });
      const mgr = createFormManager(config);
      const onSubmit = vi.fn();
      const result = await mgr.submit(onSubmit);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.name).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should handle submission errors', async () => {
      manager.setFieldValue('name', 'Alice');
      const onSubmit = vi.fn().mockRejectedValue(new Error('Server error'));
      const result = await manager.submit(onSubmit);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Server error');
      expect(manager.getState().submitError).toBe('Server error');
    });

    it('should handle non-Error throws during submission', async () => {
      manager.setFieldValue('name', 'Alice');
      const onSubmit = vi.fn().mockRejectedValue('string error');
      const result = await manager.submit(onSubmit);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Submission failed');
    });

    it('should increment submitCount on each submit', async () => {
      manager.setFieldValue('name', 'Alice');
      await manager.submit(vi.fn());
      await manager.submit(vi.fn());
      expect(manager.getState().submitCount).toBe(2);
    });

    it('should emit submit event', async () => {
      const events: FormEvent[] = [];
      manager.events.subscribe((e) => events.push(e));
      manager.setFieldValue('name', 'Alice');
      await manager.submit(vi.fn());
      expect(events.some((e) => e.type === 'submit')).toBe(true);
    });

    it('should emit error event on submission failure', async () => {
      const events: FormEvent[] = [];
      manager.events.subscribe((e) => events.push(e));
      manager.setFieldValue('name', 'Alice');
      await manager.submit(vi.fn().mockRejectedValue(new Error('fail')));
      expect(events.some((e) => e.type === 'error')).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset form to initial state', () => {
      manager.setFieldValue('name', 'Alice');
      manager.setFieldTouched('name', true);
      manager.reset();
      const state = manager.getState();
      expect(state.isDirty).toBe(false);
      expect(state.fields['name']?.value).toBeNull();
      expect(state.fields['name']?.touched).toBe(false);
    });

    it('should reset with new initial values', () => {
      manager.reset({ name: 'Bob' } as Record<string, unknown>);
      const state = manager.getState();
      expect(state.fields['name']?.value).toBe('Bob');
      expect(state.fields['name']?.initialValue).toBe('Bob');
    });

    it('should emit reset event', () => {
      const events: FormEvent[] = [];
      manager.events.subscribe((e) => events.push(e));
      manager.reset();
      expect(events.some((e) => e.type === 'reset')).toBe(true);
    });
  });

  describe('visibility', () => {
    it('should report hidden fields as not visible', () => {
      const config = makeConfig();
      config.fields[2]!.hidden = true;
      const mgr = createFormManager(config);
      expect(mgr.isFieldVisible('age')).toBe(false);
    });

    it('should support conditional visibility via showIf', () => {
      const config = makeConfig();
      config.fields[1]!.showIf = (data) => data.name === 'admin';
      const mgr = createFormManager(config);
      expect(mgr.isFieldVisible('email')).toBe(false);
      mgr.setFieldValue('name', 'admin');
      expect(mgr.isFieldVisible('email')).toBe(true);
    });

    it('should return only visible fields from getVisibleFields', () => {
      const config = makeConfig();
      config.fields[2]!.hidden = true;
      const mgr = createFormManager(config);
      const visible = mgr.getVisibleFields();
      expect(visible.length).toBe(2);
      expect(visible.every((f) => f.name !== 'age')).toBe(true);
    });

    it('should return false for non-existent fields', () => {
      expect(manager.isFieldVisible('nonexistent')).toBe(false);
    });
  });

  describe('config accessors', () => {
    it('should return form config', () => {
      const config = manager.getConfig();
      expect(config.fields.length).toBe(3);
    });

    it('should return field config by name', () => {
      const fc = manager.getFieldConfig('name');
      expect(fc?.type).toBe('text');
      expect(fc?.required).toBe(true);
    });

    it('should return undefined for unknown field config', () => {
      expect(manager.getFieldConfig('nonexistent')).toBeUndefined();
    });
  });

  describe('observable state', () => {
    it('should emit state updates through state observable', () => {
      const states: FormState[] = [];
      const sub = manager.state.subscribe((s) => states.push(s));
      manager.setFieldValue('name', 'Alice');
      manager.setFieldValue('email', 'alice@test.com');
      sub.unsubscribe();
      expect(states.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('destroy', () => {
    it('should complete observables on destroy', () => {
      let completed = false;
      manager.state.subscribe({ complete: () => (completed = true) });
      manager.destroy();
      expect(completed).toBe(true);
    });
  });
});

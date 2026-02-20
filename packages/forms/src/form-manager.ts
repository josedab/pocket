/**
 * Form Manager - Manages form state and validation
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import { type z } from 'zod';
import type {
  FieldConfig,
  FieldState,
  FieldValidation,
  FormConfig,
  FormEvent,
  FormState,
  FormSubmitResult,
} from './types.js';

/**
 * Default field state
 */
function createFieldState(config: FieldConfig): FieldState {
  return {
    value: config.defaultValue ?? null,
    initialValue: config.defaultValue ?? null,
    touched: false,
    dirty: false,
    focused: false,
    validation: {
      valid: true,
      errors: [],
      warnings: [],
      validating: false,
    },
  };
}

/**
 * Default form state
 */
function createFormState(config: FormConfig): FormState {
  const fields: Record<string, FieldState> = {};

  for (const fieldConfig of config.fields) {
    fields[fieldConfig.name] = createFieldState(fieldConfig);
  }

  return {
    fields,
    isValid: true,
    isDirty: false,
    isSubmitting: false,
    isSubmitted: false,
    submitError: null,
    submitCount: 0,
  };
}

/**
 * Manages form state and validation
 */
export class FormManager<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly config: FormConfig;
  private readonly schema?: z.ZodObject<z.ZodRawShape>;
  private readonly state$: BehaviorSubject<FormState>;
  private readonly events$ = new Subject<FormEvent>();
  private readonly fieldConfigs: Map<string, FieldConfig>;

  constructor(config: FormConfig, schema?: z.ZodObject<z.ZodRawShape>) {
    this.config = config;
    this.schema = schema;
    this.state$ = new BehaviorSubject<FormState>(createFormState(config));
    this.fieldConfigs = new Map(config.fields.map((f) => [f.name, f]));
  }

  /**
   * Get current form state
   */
  getState(): FormState {
    return this.state$.value;
  }

  /**
   * Get state observable
   */
  get state(): Observable<FormState> {
    return this.state$.asObservable();
  }

  /**
   * Get events observable
   */
  get events(): Observable<FormEvent> {
    return this.events$.asObservable();
  }

  /**
   * Get form data
   */
  getValues(): T {
    const state = this.state$.value;
    const values: Record<string, unknown> = {};

    for (const [name, fieldState] of Object.entries(state.fields)) {
      const config = this.fieldConfigs.get(name);

      // Apply parse transform if defined
      let value = fieldState.value;
      if (config?.parse) {
        value = config.parse(value);
      }

      values[name] = value;
    }

    return values as T;
  }

  /**
   * Set form data
   */
  setValues(values: Partial<T>): void {
    const state = this.state$.value;
    const newFields = { ...state.fields };

    for (const [name, value] of Object.entries(values)) {
      if (newFields[name]) {
        const config = this.fieldConfigs.get(name);

        // Apply format transform if defined
        let formattedValue = value;
        if (config?.format) {
          formattedValue = config.format(value);
        }

        newFields[name] = {
          ...newFields[name],
          value: formattedValue,
          dirty: formattedValue !== newFields[name].initialValue,
        };
      }
    }

    this.updateState({
      fields: newFields,
      isDirty: this.checkDirty(newFields),
    });

    if (this.config.validationMode === 'onChange') {
      void this.validateAll();
    }
  }

  /**
   * Set a single field value
   */
  setFieldValue(name: string, value: unknown): void {
    const state = this.state$.value;
    const fieldState = state.fields[name];
    const config = this.fieldConfigs.get(name);

    if (!fieldState) return;

    // Apply format transform if defined
    let formattedValue = value;
    if (config?.format) {
      formattedValue = config.format(value);
    }

    const newFieldState: FieldState = {
      ...fieldState,
      value: formattedValue,
      dirty: formattedValue !== fieldState.initialValue,
    };

    const newFields = {
      ...state.fields,
      [name]: newFieldState,
    };

    this.updateState({
      fields: newFields,
      isDirty: this.checkDirty(newFields),
    });

    this.emitEvent('change', name, formattedValue);

    if (this.config.validationMode === 'onChange') {
      void this.validateField(name);
    }
  }

  /**
   * Get a field value
   */
  getFieldValue(name: string): unknown {
    return this.state$.value.fields[name]?.value;
  }

  /**
   * Get a field state
   */
  getFieldState(name: string): FieldState | undefined {
    return this.state$.value.fields[name];
  }

  /**
   * Set field touched state
   */
  setFieldTouched(name: string, touched = true): void {
    const state = this.state$.value;
    const fieldState = state.fields[name];

    if (!fieldState) return;

    this.updateState({
      fields: {
        ...state.fields,
        [name]: {
          ...fieldState,
          touched,
        },
      },
    });
  }

  /**
   * Handle field focus
   */
  handleFocus(name: string): void {
    const state = this.state$.value;
    const fieldState = state.fields[name];

    if (!fieldState) return;

    this.updateState({
      fields: {
        ...state.fields,
        [name]: {
          ...fieldState,
          focused: true,
        },
      },
    });

    this.emitEvent('focus', name, fieldState.value);
  }

  /**
   * Handle field blur
   */
  handleBlur(name: string): void {
    const state = this.state$.value;
    const fieldState = state.fields[name];

    if (!fieldState) return;

    this.updateState({
      fields: {
        ...state.fields,
        [name]: {
          ...fieldState,
          focused: false,
          touched: true,
        },
      },
    });

    this.emitEvent('blur', name, fieldState.value);

    if (this.config.validationMode === 'onBlur') {
      void this.validateField(name);
    }
  }

  /**
   * Validate a single field
   */
  async validateField(name: string): Promise<FieldValidation> {
    const state = this.state$.value;
    const fieldState = state.fields[name];
    const config = this.fieldConfigs.get(name);

    if (!fieldState || !config) {
      return {
        valid: true,
        errors: [],
        warnings: [],
        validating: false,
      };
    }

    // Mark as validating
    this.updateFieldValidation(name, { validating: true });

    const errors: string[] = [];
    const value = fieldState.value;

    // Check required
    const isRequired = config.requiredIf ? config.requiredIf(this.getValues()) : config.required;

    if (isRequired && (value === null || value === undefined || value === '')) {
      errors.push(`${config.label ?? name} is required`);
    }

    // Check custom validation
    if (config.validate && !errors.length) {
      const error = config.validate(value, this.getValues());
      if (error) {
        errors.push(error);
      }
    }

    // Check async validation
    if (config.validateAsync && !errors.length) {
      try {
        const error = await config.validateAsync(value, this.getValues());
        if (error) {
          errors.push(error);
        }
      } catch {
        errors.push('Validation failed');
      }
    }

    // Validate against Zod schema
    if (this.schema && !errors.length) {
      const shape = this.schema.shape;
      const fieldSchema = shape[name];
      if (fieldSchema) {
        const result = fieldSchema.safeParse(value);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push(issue.message);
          }
        }
      }
    }

    const validation: FieldValidation = {
      valid: errors.length === 0,
      errors,
      warnings: [],
      validating: false,
    };

    this.updateFieldValidation(name, validation);
    this.updateFormValidity();
    this.emitEvent('validate', name, value);

    return validation;
  }

  /**
   * Validate all fields
   */
  async validateAll(): Promise<boolean> {
    const validations = await Promise.all(
      Array.from(this.fieldConfigs.keys()).map((name) =>
        this.validateField(name).then((v) => ({ name, valid: v.valid }))
      )
    );

    const isValid = validations.every((v) => v.valid);
    this.updateState({ isValid });

    return isValid;
  }

  /**
   * Submit the form
   */
  async submit(onSubmit: (data: T) => Promise<void> | void): Promise<FormSubmitResult<T>> {
    this.updateState({
      isSubmitting: true,
      submitError: null,
      submitCount: this.state$.value.submitCount + 1,
    });

    this.emitEvent('submit');

    // Validate if needed
    if (this.config.validationMode === 'onSubmit' || this.config.revalidateMode === 'onSubmit') {
      const isValid = await this.validateAll();
      if (!isValid) {
        this.updateState({
          isSubmitting: false,
          isSubmitted: true,
        });

        // Collect errors
        const errors: Record<string, string[]> = {};
        for (const [name, fieldState] of Object.entries(this.state$.value.fields)) {
          if (fieldState.validation.errors.length > 0) {
            errors[name] = fieldState.validation.errors;
          }
        }

        return {
          success: false,
          errors,
          error: 'Validation failed',
        };
      }
    }

    try {
      const data = this.getValues();
      await onSubmit(data);

      this.updateState({
        isSubmitting: false,
        isSubmitted: true,
      });

      return {
        success: true,
        data,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Submission failed';

      this.updateState({
        isSubmitting: false,
        isSubmitted: true,
        submitError: error,
      });

      this.emitEvent('error');

      return {
        success: false,
        error,
      };
    }
  }

  /**
   * Reset the form
   */
  reset(values?: Partial<T>): void {
    const newState = createFormState(this.config);

    if (values) {
      for (const [name, value] of Object.entries(values)) {
        if (newState.fields[name]) {
          newState.fields[name].value = value;
          newState.fields[name].initialValue = value;
        }
      }
    }

    this.state$.next(newState);
    this.emitEvent('reset');
  }

  /**
   * Check if form is dirty
   */
  private checkDirty(fields: Record<string, FieldState>): boolean {
    return Object.values(fields).some((f) => f.dirty);
  }

  /**
   * Update field validation state
   */
  private updateFieldValidation(name: string, validation: Partial<FieldValidation>): void {
    const state = this.state$.value;
    const fieldState = state.fields[name];

    if (!fieldState) return;

    this.updateState({
      fields: {
        ...state.fields,
        [name]: {
          ...fieldState,
          validation: {
            ...fieldState.validation,
            ...validation,
          },
        },
      },
    });
  }

  /**
   * Update form validity based on field validations
   */
  private updateFormValidity(): void {
    const state = this.state$.value;
    const isValid = Object.values(state.fields).every((f) => f.validation.valid);
    this.updateState({ isValid });
  }

  /**
   * Update state
   */
  private updateState(partial: Partial<FormState>): void {
    this.state$.next({
      ...this.state$.value,
      ...partial,
    });
  }

  /**
   * Emit a form event
   */
  private emitEvent(type: FormEvent['type'], fieldName?: string, value?: unknown): void {
    this.events$.next({
      type,
      fieldName,
      value,
      formData: this.getValues(),
      timestamp: Date.now(),
    });
  }

  /**
   * Get form configuration
   */
  getConfig(): FormConfig {
    return this.config;
  }

  /**
   * Get field configuration
   */
  getFieldConfig(name: string): FieldConfig | undefined {
    return this.fieldConfigs.get(name);
  }

  /**
   * Check if a field is visible
   */
  isFieldVisible(name: string): boolean {
    const config = this.fieldConfigs.get(name);
    if (!config) return false;
    if (config.hidden) return false;
    if (config.showIf) {
      return config.showIf(this.getValues());
    }
    return true;
  }

  /**
   * Get visible fields
   */
  getVisibleFields(): FieldConfig[] {
    return this.config.fields.filter((f) => this.isFieldVisible(f.name));
  }

  /** Release resources held by this form manager */
  destroy(): void {
    this.state$.complete();
    this.events$.complete();
  }
}

/**
 * Create a form manager
 */
export function createFormManager<T extends Record<string, unknown>>(
  config: FormConfig,
  schema?: z.ZodObject<z.ZodRawShape>
): FormManager<T> {
  return new FormManager<T>(config, schema);
}

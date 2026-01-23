/**
 * Types for Schema-Driven Forms
 */

import type { z } from 'zod';

/**
 * Field types supported by the form system
 */
export type FieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'toggle'
  | 'file'
  | 'image'
  | 'color'
  | 'range'
  | 'json'
  | 'array'
  | 'object'
  | 'relation'
  | 'custom';

/**
 * Field validation state
 */
export interface FieldValidation {
  /** Whether field is valid */
  valid: boolean;
  /** Error messages */
  errors: string[];
  /** Warning messages */
  warnings: string[];
  /** Whether validation is in progress */
  validating: boolean;
}

/**
 * Select/Radio option
 */
export interface FieldOption {
  /** Option value */
  value: string | number;
  /** Display label */
  label: string;
  /** Whether option is disabled */
  disabled?: boolean;
  /** Option description */
  description?: string;
  /** Option icon/image */
  icon?: string;
}

/**
 * Field configuration
 */
export interface FieldConfig {
  /** Field name/path */
  name: string;
  /** Field type */
  type: FieldType;
  /** Display label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Help text */
  helpText?: string;
  /** Default value */
  defaultValue?: unknown;
  /** Whether field is required */
  required?: boolean;
  /** Whether field is disabled */
  disabled?: boolean;
  /** Whether field is read-only */
  readOnly?: boolean;
  /** Whether field is hidden */
  hidden?: boolean;
  /** Options (for select, radio, etc.) */
  options?: FieldOption[];
  /** Minimum value (for number, date) */
  min?: number | string;
  /** Maximum value (for number, date) */
  max?: number | string;
  /** Step value (for number, range) */
  step?: number;
  /** Pattern for validation */
  pattern?: string;
  /** Minimum length */
  minLength?: number;
  /** Maximum length */
  maxLength?: number;
  /** Number of rows (for textarea) */
  rows?: number;
  /** Accepted file types */
  accept?: string;
  /** Multiple selection allowed */
  multiple?: boolean;
  /** Field group/section */
  group?: string;
  /** Display order */
  order?: number;
  /** CSS class name */
  className?: string;
  /** Custom validation function */
  validate?: (value: unknown, formData: Record<string, unknown>) => string | null;
  /** Async validation function */
  validateAsync?: (value: unknown, formData: Record<string, unknown>) => Promise<string | null>;
  /** Transform value before display */
  format?: (value: unknown) => unknown;
  /** Transform value before submission */
  parse?: (value: unknown) => unknown;
  /** Conditional visibility */
  showIf?: (formData: Record<string, unknown>) => boolean;
  /** Conditional requirement */
  requiredIf?: (formData: Record<string, unknown>) => boolean;
  /** Relation configuration */
  relation?: RelationConfig;
  /** Nested fields (for array/object types) */
  fields?: FieldConfig[];
  /** Custom component name */
  component?: string;
  /** Additional component props */
  componentProps?: Record<string, unknown>;
}

/**
 * Relation configuration for related documents
 */
export interface RelationConfig {
  /** Related collection name */
  collection: string;
  /** Field to display */
  displayField: string;
  /** Value field */
  valueField?: string;
  /** Filter for related documents */
  filter?: Record<string, unknown>;
  /** Allow creating new items */
  allowCreate?: boolean;
  /** Maximum selections (for multi-select relations) */
  maxSelections?: number;
}

/**
 * Form field state
 */
export interface FieldState {
  /** Current value */
  value: unknown;
  /** Initial value */
  initialValue: unknown;
  /** Whether field has been touched */
  touched: boolean;
  /** Whether field has been modified */
  dirty: boolean;
  /** Validation state */
  validation: FieldValidation;
  /** Whether field is focused */
  focused: boolean;
}

/**
 * Form configuration
 */
export interface FormConfig {
  /** Unique form ID */
  id?: string;
  /** Form title */
  title?: string;
  /** Form description */
  description?: string;
  /** Field configurations */
  fields: FieldConfig[];
  /** Field groups/sections */
  groups?: FormGroup[];
  /** Form layout */
  layout?: FormLayout;
  /** Validation mode */
  validationMode?: 'onChange' | 'onBlur' | 'onSubmit';
  /** Re-validate mode */
  revalidateMode?: 'onChange' | 'onBlur' | 'onSubmit';
  /** Whether to show validation errors immediately */
  showErrorsImmediately?: boolean;
  /** Submit button text */
  submitText?: string;
  /** Reset button text */
  resetText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Show reset button */
  showReset?: boolean;
  /** Show cancel button */
  showCancel?: boolean;
  /** Form CSS class */
  className?: string;
  /** Disable autocomplete */
  noAutocomplete?: boolean;
}

/**
 * Form group/section
 */
export interface FormGroup {
  /** Group ID */
  id: string;
  /** Group label */
  label?: string;
  /** Group description */
  description?: string;
  /** Fields in this group */
  fields: string[];
  /** Whether group is collapsible */
  collapsible?: boolean;
  /** Whether group starts collapsed */
  collapsed?: boolean;
  /** Display order */
  order?: number;
  /** CSS class */
  className?: string;
}

/**
 * Form layout options
 */
export interface FormLayout {
  /** Layout type */
  type: 'vertical' | 'horizontal' | 'inline' | 'grid';
  /** Columns (for grid layout) */
  columns?: number;
  /** Column gap */
  columnGap?: string;
  /** Row gap */
  rowGap?: string;
  /** Label width (for horizontal layout) */
  labelWidth?: string;
  /** Label alignment */
  labelAlign?: 'left' | 'right' | 'top';
}

/**
 * Form state
 */
export interface FormState {
  /** Field states */
  fields: Record<string, FieldState>;
  /** Whether form is valid */
  isValid: boolean;
  /** Whether form is dirty (any field modified) */
  isDirty: boolean;
  /** Whether form is submitting */
  isSubmitting: boolean;
  /** Whether form has been submitted */
  isSubmitted: boolean;
  /** Submission error */
  submitError: string | null;
  /** Submit count */
  submitCount: number;
}

/**
 * Form submission result
 */
export interface FormSubmitResult<T = Record<string, unknown>> {
  /** Whether submission was successful */
  success: boolean;
  /** Submitted data */
  data?: T;
  /** Errors */
  errors?: Record<string, string[]>;
  /** Error message */
  error?: string;
}

/**
 * Schema metadata for form generation
 */
export interface SchemaMetadata {
  /** Field label */
  label?: string;
  /** Field placeholder */
  placeholder?: string;
  /** Help text */
  helpText?: string;
  /** Field type override */
  fieldType?: FieldType;
  /** Options for select fields */
  options?: FieldOption[];
  /** Group assignment */
  group?: string;
  /** Display order */
  order?: number;
  /** Component override */
  component?: string;
  /** Additional props */
  props?: Record<string, unknown>;
  /** Whether field is hidden */
  hidden?: boolean;
  /** Relation configuration */
  relation?: RelationConfig;
}

/**
 * Zod schema with form metadata
 */
export type ZodSchemaWithMeta<T extends z.ZodTypeAny = z.ZodTypeAny> = T & {
  _formMeta?: SchemaMetadata;
};

/**
 * Form event types
 */
export type FormEventType = 'change' | 'blur' | 'focus' | 'validate' | 'submit' | 'reset' | 'error';

/**
 * Form event
 */
export interface FormEvent {
  /** Event type */
  type: FormEventType;
  /** Field name (if applicable) */
  fieldName?: string;
  /** Field value (if applicable) */
  value?: unknown;
  /** Form data */
  formData: Record<string, unknown>;
  /** Event timestamp */
  timestamp: number;
}

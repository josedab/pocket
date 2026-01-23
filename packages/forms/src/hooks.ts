/**
 * React hooks for Schema-Driven Forms
 */

import type { FormManager } from './form-manager.js';
import type { FieldConfig, FieldState, FormConfig, FormEvent, FormState } from './types.js';

/**
 * React hooks interface for dependency injection
 */
export interface ReactHooks {
  useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;
  useEffect(fn: () => undefined | (() => void), deps?: unknown[]): void;
  useMemo<T>(fn: () => T, deps: unknown[]): T;
  useRef<T>(initial: T): { current: T };
}

/**
 * Return type for useForm hook
 */
export interface UseFormReturn<T extends Record<string, unknown>> {
  /** Form state */
  state: FormState;
  /** Form configuration */
  config: FormConfig;
  /** Get all values */
  getValues: () => T;
  /** Set all values */
  setValues: (values: Partial<T>) => void;
  /** Set a field value */
  setValue: (name: string, value: unknown) => void;
  /** Get a field value */
  getValue: (name: string) => unknown;
  /** Get field state */
  getFieldState: (name: string) => FieldState | undefined;
  /** Get field config */
  getFieldConfig: (name: string) => FieldConfig | undefined;
  /** Handle change event */
  handleChange: (name: string, value: unknown) => void;
  /** Handle blur event */
  handleBlur: (name: string) => void;
  /** Handle focus event */
  handleFocus: (name: string) => void;
  /** Validate a field */
  validateField: (name: string) => Promise<void>;
  /** Validate all fields */
  validateAll: () => Promise<boolean>;
  /** Submit the form */
  submit: (onSubmit: (data: T) => Promise<void> | void) => Promise<void>;
  /** Reset the form */
  reset: (values?: Partial<T>) => void;
  /** Check if field is visible */
  isFieldVisible: (name: string) => boolean;
  /** Get visible fields */
  getVisibleFields: () => FieldConfig[];
  /** Register field props */
  register: (name: string) => FieldProps;
}

/**
 * Field props for input registration
 */
export interface FieldProps {
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  onFocus: () => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
}

/**
 * Factory to create useForm hook
 */
export function createUseFormHook(React: ReactHooks) {
  return function useForm<T extends Record<string, unknown>>(
    manager: FormManager<T>
  ): UseFormReturn<T> {
    const [state, setState] = React.useState<FormState>(() => manager.getState());

    // Subscribe to state changes
    React.useEffect(() => {
      const subscription = manager.state.subscribe((newState: FormState) => {
        setState(newState);
      });

      return () => subscription.unsubscribe();
    }, [manager]);

    const config = React.useMemo(() => manager.getConfig(), [manager]);

    const getValues = React.useCallback(() => {
      return manager.getValues();
    }, [manager]) as () => T;

    const setValues = React.useCallback(
      (values: Partial<T>) => {
        manager.setValues(values);
      },
      [manager]
    ) as (values: Partial<T>) => void;

    const setValue = React.useCallback(
      (name: string, value: unknown) => {
        manager.setFieldValue(name, value);
      },
      [manager]
    ) as (name: string, value: unknown) => void;

    const getValue = React.useCallback(
      (name: string) => {
        return manager.getFieldValue(name);
      },
      [manager]
    ) as (name: string) => unknown;

    const getFieldState = React.useCallback(
      (name: string) => {
        return manager.getFieldState(name);
      },
      [manager]
    ) as (name: string) => FieldState | undefined;

    const getFieldConfig = React.useCallback(
      (name: string) => {
        return manager.getFieldConfig(name);
      },
      [manager]
    ) as (name: string) => FieldConfig | undefined;

    const handleChange = React.useCallback(
      (name: string, value: unknown) => {
        manager.setFieldValue(name, value);
      },
      [manager]
    ) as (name: string, value: unknown) => void;

    const handleBlur = React.useCallback(
      (name: string) => {
        manager.handleBlur(name);
      },
      [manager]
    ) as (name: string) => void;

    const handleFocus = React.useCallback(
      (name: string) => {
        manager.handleFocus(name);
      },
      [manager]
    ) as (name: string) => void;

    const validateField = React.useCallback(
      async (name: string) => {
        await manager.validateField(name);
      },
      [manager]
    ) as (name: string) => Promise<void>;

    const validateAll = React.useCallback(async () => {
      return manager.validateAll();
    }, [manager]) as () => Promise<boolean>;

    const submit = React.useCallback(
      async (onSubmit: (data: T) => Promise<void> | void) => {
        await manager.submit(onSubmit);
      },
      [manager]
    ) as (onSubmit: (data: T) => Promise<void> | void) => Promise<void>;

    const reset = React.useCallback(
      (values?: Partial<T>) => {
        manager.reset(values);
      },
      [manager]
    ) as (values?: Partial<T>) => void;

    const isFieldVisible = React.useCallback(
      (name: string) => {
        return manager.isFieldVisible(name);
      },
      [manager]
    ) as (name: string) => boolean;

    const getVisibleFields = React.useCallback(() => {
      return manager.getVisibleFields();
    }, [manager]) as () => FieldConfig[];

    const register = React.useCallback(
      (name: string): FieldProps => {
        const fieldConfig = manager.getFieldConfig(name);
        const fieldState = manager.getFieldState(name);

        return {
          name,
          value: fieldState?.value,
          onChange: (value: unknown) => manager.setFieldValue(name, value),
          onBlur: () => manager.handleBlur(name),
          onFocus: () => manager.handleFocus(name),
          disabled: fieldConfig?.disabled,
          required: fieldConfig?.required,
          placeholder: fieldConfig?.placeholder,
        };
      },
      [manager]
    ) as (name: string) => FieldProps;

    return {
      state,
      config,
      getValues,
      setValues,
      setValue,
      getValue,
      getFieldState,
      getFieldConfig,
      handleChange,
      handleBlur,
      handleFocus,
      validateField,
      validateAll,
      submit,
      reset,
      isFieldVisible,
      getVisibleFields,
      register,
    };
  };
}

/**
 * Return type for useField hook
 */
export interface UseFieldReturn {
  /** Field value */
  value: unknown;
  /** Field state */
  state: FieldState | undefined;
  /** Field config */
  config: FieldConfig | undefined;
  /** Set value */
  setValue: (value: unknown) => void;
  /** Handle change */
  onChange: (value: unknown) => void;
  /** Handle blur */
  onBlur: () => void;
  /** Handle focus */
  onFocus: () => void;
  /** Validation errors */
  errors: string[];
  /** Whether field is valid */
  isValid: boolean;
  /** Whether field is touched */
  isTouched: boolean;
  /** Whether field is dirty */
  isDirty: boolean;
  /** Whether field is visible */
  isVisible: boolean;
  /** Field props for registration */
  props: FieldProps;
}

/**
 * Factory to create useField hook
 */
export function createUseFieldHook(React: ReactHooks) {
  return function useField<T extends Record<string, unknown>>(
    manager: FormManager<T>,
    name: string
  ): UseFieldReturn {
    const [state, setState] = React.useState<FieldState | undefined>(() =>
      manager.getFieldState(name)
    );

    React.useEffect(() => {
      const subscription = manager.state.subscribe((formState: FormState) => {
        setState(formState.fields[name]);
      });

      return () => subscription.unsubscribe();
    }, [manager, name]);

    const config = React.useMemo(() => manager.getFieldConfig(name), [manager, name]);

    const setValue = React.useCallback(
      (value: unknown) => {
        manager.setFieldValue(name, value);
      },
      [manager, name]
    ) as (value: unknown) => void;

    const onChange = React.useCallback(
      (value: unknown) => {
        manager.setFieldValue(name, value);
      },
      [manager, name]
    ) as (value: unknown) => void;

    const onBlur = React.useCallback(() => {
      manager.handleBlur(name);
    }, [manager, name]) as () => void;

    const onFocus = React.useCallback(() => {
      manager.handleFocus(name);
    }, [manager, name]) as () => void;

    const isVisible = React.useMemo(() => {
      return manager.isFieldVisible(name);
    }, [manager, name]);

    const props: FieldProps = React.useMemo(
      () => ({
        name,
        value: state?.value,
        onChange,
        onBlur,
        onFocus,
        disabled: config?.disabled,
        required: config?.required,
        placeholder: config?.placeholder,
      }),
      [name, state?.value, onChange, onBlur, onFocus, config]
    );

    return {
      value: state?.value,
      state,
      config,
      setValue,
      onChange,
      onBlur,
      onFocus,
      errors: state?.validation.errors ?? [],
      isValid: state?.validation.valid ?? true,
      isTouched: state?.touched ?? false,
      isDirty: state?.dirty ?? false,
      isVisible,
      props,
    };
  };
}

/**
 * Factory to create useFormEvents hook
 */
export function createUseFormEventsHook(React: ReactHooks) {
  return function useFormEvents<T extends Record<string, unknown>>(
    manager: FormManager<T>,
    handlers: {
      onChange?: (event: FormEvent) => void;
      onBlur?: (event: FormEvent) => void;
      onFocus?: (event: FormEvent) => void;
      onSubmit?: (event: FormEvent) => void;
      onReset?: (event: FormEvent) => void;
      onValidate?: (event: FormEvent) => void;
      onError?: (event: FormEvent) => void;
    }
  ): void {
    React.useEffect(() => {
      const subscription = manager.events.subscribe((event: FormEvent) => {
        switch (event.type) {
          case 'change':
            handlers.onChange?.(event);
            break;
          case 'blur':
            handlers.onBlur?.(event);
            break;
          case 'focus':
            handlers.onFocus?.(event);
            break;
          case 'submit':
            handlers.onSubmit?.(event);
            break;
          case 'reset':
            handlers.onReset?.(event);
            break;
          case 'validate':
            handlers.onValidate?.(event);
            break;
          case 'error':
            handlers.onError?.(event);
            break;
        }
      });

      return () => subscription.unsubscribe();
    }, [manager, handlers]);
  };
}

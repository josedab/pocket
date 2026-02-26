/**
 * Interactive Tutorial Engine — step-by-step guided tutorials
 * with validation and progress tracking.
 */

/** A single step in a tutorial. */
export interface TutorialStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Starting code template for this step. */
  readonly starterCode: string;
  /** Hints shown progressively if the user is stuck. */
  readonly hints: readonly string[];
  /** Validation function that checks if the step is completed. */
  readonly validate: (output: string) => boolean;
  /** Solution code (shown if user gives up). */
  readonly solution?: string;
}

/** Tutorial definition. */
export interface Tutorial {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly difficulty: 'beginner' | 'intermediate' | 'advanced';
  readonly steps: readonly TutorialStep[];
  readonly estimatedMinutes: number;
}

/** Progress through a tutorial. */
export interface TutorialProgress {
  readonly tutorialId: string;
  readonly currentStepIndex: number;
  readonly completedSteps: readonly string[];
  readonly hintsUsed: Record<string, number>;
  readonly startedAt: number;
  readonly completedAt?: number;
}

export class TutorialEngine {
  private readonly tutorials = new Map<string, Tutorial>();
  private readonly progress = new Map<string, TutorialProgress>();

  /** Register a tutorial. */
  addTutorial(tutorial: Tutorial): void {
    this.tutorials.set(tutorial.id, tutorial);
  }

  /** Get all registered tutorials. */
  listTutorials(): readonly Tutorial[] {
    return Array.from(this.tutorials.values());
  }

  /** Get a tutorial by ID. */
  getTutorial(id: string): Tutorial | undefined {
    return this.tutorials.get(id);
  }

  /** Start a tutorial and return the first step. */
  start(tutorialId: string): TutorialStep | undefined {
    const tutorial = this.tutorials.get(tutorialId);
    if (!tutorial || tutorial.steps.length === 0) return undefined;

    this.progress.set(tutorialId, {
      tutorialId,
      currentStepIndex: 0,
      completedSteps: [],
      hintsUsed: {},
      startedAt: Date.now(),
    });

    return tutorial.steps[0];
  }

  /** Get the current step for a tutorial in progress. */
  getCurrentStep(tutorialId: string): TutorialStep | undefined {
    const progress = this.progress.get(tutorialId);
    const tutorial = this.tutorials.get(tutorialId);
    if (!progress || !tutorial) return undefined;
    return tutorial.steps[progress.currentStepIndex];
  }

  /** Validate a step's output and advance if correct. */
  validateStep(
    tutorialId: string,
    output: string
  ): {
    passed: boolean;
    nextStep?: TutorialStep;
    completed: boolean;
  } {
    const progress = this.progress.get(tutorialId);
    const tutorial = this.tutorials.get(tutorialId);
    if (!progress || !tutorial) {
      return { passed: false, completed: false };
    }

    const currentStep = tutorial.steps[progress.currentStepIndex];
    if (!currentStep) return { passed: false, completed: false };

    const passed = currentStep.validate(output);
    if (!passed) {
      return { passed: false, completed: false };
    }

    // Mark step completed and advance
    const nextIndex = progress.currentStepIndex + 1;
    const completed = nextIndex >= tutorial.steps.length;

    this.progress.set(tutorialId, {
      ...progress,
      currentStepIndex: nextIndex,
      completedSteps: [...progress.completedSteps, currentStep.id],
      completedAt: completed ? Date.now() : undefined,
    });

    return {
      passed: true,
      nextStep: completed ? undefined : tutorial.steps[nextIndex],
      completed,
    };
  }

  /** Get a hint for the current step. Returns next unused hint or undefined. */
  getHint(tutorialId: string): string | undefined {
    const progress = this.progress.get(tutorialId);
    const tutorial = this.tutorials.get(tutorialId);
    if (!progress || !tutorial) return undefined;

    const step = tutorial.steps[progress.currentStepIndex];
    if (!step) return undefined;

    const hintsUsed = progress.hintsUsed[step.id] ?? 0;
    if (hintsUsed >= step.hints.length) return undefined;

    this.progress.set(tutorialId, {
      ...progress,
      hintsUsed: { ...progress.hintsUsed, [step.id]: hintsUsed + 1 },
    });

    return step.hints[hintsUsed];
  }

  /** Get progress for a tutorial. */
  getProgress(tutorialId: string): TutorialProgress | undefined {
    return this.progress.get(tutorialId);
  }

  /** Reset progress for a tutorial. */
  reset(tutorialId: string): void {
    this.progress.delete(tutorialId);
  }
}

export function createTutorialEngine(): TutorialEngine {
  return new TutorialEngine();
}

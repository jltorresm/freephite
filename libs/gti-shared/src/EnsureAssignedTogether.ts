/**
 * Given an object type with multiple keys, produce a type that has either all of the keys non-null, or all the keys undefined
 * ```
 * EnsureAssignedTogether<{a: number, b: string}> === {a: number, b: string} | {a?: undefined, b?: undefined}
 * ```
 * This is useful for props that need to be provided together.
 **/
export type EnsureAssignedTogether<T extends object> =
  | T
  | { [key in keyof T]?: undefined };

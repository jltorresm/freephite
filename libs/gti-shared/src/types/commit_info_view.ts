export type TypeaheadKind =
  | "meta-user"
  | "meta-task"
  | "meta-tag"
  | "meta-diff";
export type TypeaheadResult = {
  /** The display text of the suggestion */
  label: string;

  /**
   * The literal value of the suggestion,
   * shown de-emphasized next to the display name
   * and placed literally as text into the commit message
   */
  value: string;

  /**
   * An optional image url representing this result. Usually, a user avatar.
   */
  image?: string;
};

/**
 * Dynamic configuration for a single field in a commit message
 */
export type FieldConfig = {
  /**
   * Label for this field, and the value used to parse this key from the string.
   * For example, "Summary" corresponds to 'Summary:' in the commit message.
   * There are some specially handled values:
   *   'Title' -> we don't look for "title: foo", we assume first line is the title always.
   *   'Description' -> we don't look for "description: foo", description is handled as the entire message
   */
  label: "Title" | string;
  /** Codicon to show next to this field */
  icon: string;
} & (
  | {
      /**
       * Type of the field to show in the UI.
       * textarea => long form content, with extra buttons for image uploading, etc. Supports vertical resize.
       * field => single-line, tokenized field
       * title => non-resizeable textarea for the title, which has special rendering.
       */
      type: "title" | "textarea";
    }
  | {
      type: "field";
      typeaheadKind: TypeaheadKind;
    }
);

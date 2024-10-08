import type { FieldConfig } from "@withgraphite/gti-shared";
import type { ReactNode } from "react";

import { SeeMoreContainer } from "./SeeMoreContainer";
import { CommitInfoTextArea } from "./TextArea";
import { CommitInfoTextField } from "./TextField";
import { Section, SmallCapsTitle } from "./utils";
import { Fragment } from "react";
import { Icon } from "../Icon";
import { observer } from "mobx-react-lite";

export const CommitInfoField = observer(
  ({
    field,
    fieldKey,
    isBeingEdited,
    readonly,
    content,
    editedField,
    startEditingField,
    setEditedField,
    extra,
    autofocus,
  }: {
    field: FieldConfig;
    fieldKey: string;
    isBeingEdited: boolean;
    readonly: boolean;
    startEditingField: () => void;
    content?: string | Array<string>;
    editedField: string | Array<string> | undefined;
    setEditedField: (value: string) => unknown;
    extra?: JSX.Element;
    autofocus?: boolean;
  }): JSX.Element | null => {
    const editedFieldContent =
      editedField == null
        ? ""
        : Array.isArray(editedField)
        ? editedField.join(", ")
        : editedField;
    if (field.type === "title") {
      return (
        <>
          {isBeingEdited ? (
            <Section className="commit-info-title-field-section">
              <SmallCapsTitle>
                <Icon icon="milestone" />
                <>{field.label}</>
              </SmallCapsTitle>
              <CommitInfoTextArea
                kind={field.type}
                name={fieldKey}
                autoFocus={autofocus ?? false}
                editedMessage={editedFieldContent}
                setEditedCommitMessage={setEditedField}
              />
            </Section>
          ) : (
            <ClickToEditField
              startEditingField={readonly ? undefined : startEditingField}
              kind={field.type}
              fieldKey={fieldKey}
            >
              <span>{content || <span className="subtle">Untitled</span>}</span>
              {readonly ? null : (
                <span className="hover-edit-button">
                  <Icon icon="edit" />
                </span>
              )}
            </ClickToEditField>
          )}
          {extra}
        </>
      );
    } else {
      const Wrapper = field.type === "field" ? Fragment : SeeMoreContainer;
      return isBeingEdited ? (
        <Section className="commit-info-field-section">
          <SmallCapsTitle>
            <Icon icon={field.icon} />
            {field.label}
          </SmallCapsTitle>
          {field.type === "field" ? (
            <CommitInfoTextField
              name={field.label}
              autoFocus={autofocus ?? false}
              editedMessage={editedFieldContent}
              setEditedCommitMessage={setEditedField}
              typeaheadKind={field.typeaheadKind}
            />
          ) : (
            <CommitInfoTextArea
              kind={field.type}
              name={field.label}
              autoFocus={autofocus ?? false}
              editedMessage={editedFieldContent}
              setEditedCommitMessage={setEditedField}
            />
          )}
        </Section>
      ) : (
        <Section>
          <Wrapper>
            <ClickToEditField
              startEditingField={readonly ? undefined : startEditingField}
              kind={field.type}
              fieldKey={fieldKey}
            >
              <SmallCapsTitle>
                <Icon icon={field.icon} />
                <>{field.label}</>
                {readonly ? null : (
                  <span className="hover-edit-button">
                    <Icon icon="edit" />
                  </span>
                )}
              </SmallCapsTitle>
              {content && content !== "" ? (
                <div>{content}</div>
              ) : (
                <span className="empty-description subtle">
                  {readonly ? (
                    <>
                      <> No {field.label}</>
                    </>
                  ) : (
                    <>
                      <Icon icon="add" />
                      <> Click to add {field.label}</>
                    </>
                  )}
                </span>
              )}
            </ClickToEditField>
          </Wrapper>
        </Section>
      );
    }
  }
);

function ClickToEditField({
  children,
  startEditingField,
  fieldKey,
  kind,
}: {
  children: ReactNode;
  /** function to run when you click to edit. If null, the entire field will be non-editable. */
  startEditingField?: () => void;
  fieldKey: string;
  kind: "title" | "field" | "textarea";
}) {
  const editable = startEditingField != null;
  const renderKey = fieldKey.toLowerCase().replace(/\s/g, "-");
  return (
    <div
      className={`commit-info-rendered-${kind}${
        editable ? "" : " non-editable"
      }`}
      data-testid={`commit-info-rendered-${renderKey}`}
      onClick={
        startEditingField != null
          ? () => {
              startEditingField();
            }
          : undefined
      }
      onKeyPress={
        startEditingField != null
          ? (e) => {
              if (e.key === "Enter") {
                startEditingField();
              }
            }
          : undefined
      }
      tabIndex={0}
    >
      {children}
    </div>
  );
}

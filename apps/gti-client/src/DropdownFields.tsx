import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { Icon } from "./Icon";

import "./DropdownFields.scss";

export function DropdownFields({
  title,
  icon,
  children,
  className,
  ...rest
}: {
  title: React.ReactNode;
  icon: string;
  children: React.ReactNode;
  "data-testid"?: string;
  className?: string;
}) {
  return (
    <div
      className={"dropdown-fields" + (className != null ? ` ${className}` : "")}
      {...rest}
    >
      <div className="dropdown-fields-header">
        <Icon icon={icon} size="M" />
        <strong role="heading">{title}</strong>
      </div>
      <VSCodeDivider />
      <div className="dropdown-fields-content">{children}</div>
    </div>
  );
}

export function DropdownField({
  title,
  children,
  ...rest
}: {
  title: React.ReactNode;
  children: React.ReactNode;
} & Omit<
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>,
  "title"
>) {
  return (
    <div className="dropdown-field">
      <strong>{title}</strong>
      <div {...rest}>{children}</div>
    </div>
  );
}

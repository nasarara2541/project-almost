"use client";

export type SectionId =
  | "top"
  | "start-here"
  | "gaps"
  | "opportunities"
  | "repository-explorer"
  | "interface";

type Section = { id: SectionId; label: string };

const SECTIONS: Section[] = [
  { id: "top", label: "Overview" },
  { id: "start-here", label: "Start here" },
  { id: "gaps", label: "Gaps" },
  { id: "opportunities", label: "Contribute" },
  { id: "repository-explorer", label: "Explorer" },
  { id: "interface", label: "Interface" },
];

type SectionNavProps = {
  activeId: SectionId;
  onSelect: (id: SectionId) => void;
};

/** A persistent report switcher. Only the selected report view is mounted. */
export function SectionNav({ activeId, onSelect }: SectionNavProps) {
  return (
    <nav className="section-nav" aria-label="Repository report sections">
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          id={`section-nav-${section.id}`}
          type="button"
          onClick={() => onSelect(section.id)}
          aria-controls={`section-view-${section.id}`}
          aria-current={activeId === section.id ? "page" : undefined}
          className={`section-nav__link ${activeId === section.id ? "is-active" : ""}`}
        >
          <span className="section-nav__dot" aria-hidden="true" />
          <span className="section-nav__label">{section.label}</span>
        </button>
      ))}
    </nav>
  );
}

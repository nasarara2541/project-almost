"use client";

import { useEffect, useState } from "react";

type Section = { id: string; label: string };

const SECTIONS: Section[] = [
  { id: "top", label: "Overview" },
  { id: "start-here", label: "Start here" },
  { id: "gaps", label: "Gaps" },
  { id: "opportunities", label: "Contribute" },
  { id: "repository-explorer", label: "Explorer" },
  { id: "interface", label: "Interface" },
];

/**
 * A fixed rail of jump links so a long results page is a map, not a scroll.
 * Only mounted once analysis results exist, so every target section is
 * already in the DOM by the time it observes them.
 */
export function SectionNav() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    const elements = SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (element): element is HTMLElement => Boolean(element),
    );
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveId(visible.target.id);
      },
      { rootMargin: "-15% 0px -65% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function jumpTo(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  }

  return (
    <nav className="section-nav" aria-label="Jump to section">
      {SECTIONS.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          onClick={(event) => jumpTo(event, section.id)}
          className={`section-nav__link ${activeId === section.id ? "is-active" : ""}`}
        >
          <span className="section-nav__dot" aria-hidden="true" />
          <span className="section-nav__label">{section.label}</span>
        </a>
      ))}
    </nav>
  );
}

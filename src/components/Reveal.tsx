import { useEffect, useRef, useState, type ReactNode } from "react";

// Apparition en fondu d'un bloc lorsqu'il entre dans le champ de vision, via IntersectionObserver
// plutôt qu'un écouteur de scroll : le navigateur fait le calcul hors du fil principal, sans
// recalculer une position à chaque pixel défilé (ce qui saccade sur les téléphones d'entrée de
// gamme, majoritaires sur ce service).
//
// Deux garde-fous, parce qu'un contenu ne doit jamais dépendre d'une animation pour s'afficher :
//   - si l'API n'existe pas (navigateur ancien), le bloc est visible d'emblée ;
//   - si l'utilisateur a demandé moins d'animations dans son système, on n'anime pas du tout —
//     ces réglages existent notamment pour les personnes sujettes au mal des transports.
// L'observateur se déconnecte au premier passage : l'apparition ne se rejoue pas quand on
// remonte, un texte qui clignote à chaque aller-retour finit par gêner la lecture.

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

interface RevealProps {
  children: ReactNode;
  className?: string;
  // Décalage en millisecondes, pour faire apparaître une grille de cartes en cascade plutôt
  // que d'un bloc. À garder court : au-delà de ~100 ms par carte, l'attente devient perceptible.
  delay?: number;
  as?: "div" | "section" | "p" | "h2";
}

export default function Reveal({ children, className = "", delay = 0, as: Tag = "div" }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined" || prefersReducedMotion()
  );

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // La marge négative retarde le déclenchement jusqu'à ce que le bloc soit franchement
      // entré dans l'écran : sinon l'apparition se joue sur la toute dernière ligne de pixels,
      // hors du regard, et le bloc paraît déjà là quand on arrive dessus.
      { rootMargin: "0px 0px -8% 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <Tag
      ref={ref as React.Ref<any>}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`${className} transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
    >
      {children}
    </Tag>
  );
}

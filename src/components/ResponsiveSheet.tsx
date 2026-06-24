import React from "react";
import { motion, useDragControls, type PanInfo } from "motion/react";
import { useIsMobile } from "../hooks/useIsMobile";

interface ResponsiveSheetProps {
  id?: string;
  panelId?: string;
  onClose: () => void;
  /** Classes propres à chaque appel (largeur max, overflow, padding, flex...). */
  panelClassName?: string;
  /** Classes additionnelles sur le fond/overlay (ex: "sm:overflow-y-auto" si le panneau n'a pas son propre scroll interne). */
  overlayClassName?: string;
  children: React.ReactNode;
}

/**
 * Modal centrée sur desktop, bottom sheet glissable sur mobile (poignée en haut,
 * glisser vers le bas pour fermer). Le drag n'est actif que sur la poignée
 * (useDragControls + dragListener={false}) pour ne pas interférer avec le scroll
 * interne du contenu.
 */
export default function ResponsiveSheet({ id, panelId, onClose, panelClassName = "", overlayClassName = "", children }: ResponsiveSheetProps) {
  const isMobile = useIsMobile();
  const dragControls = useDragControls();

  function handleDragEnd(_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  }

  return (
    <div
      id={id}
      className={`fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 bg-black/55 backdrop-blur-xs ${overlayClassName}`}
    >
      <motion.div
        id={panelId}
        initial={isMobile ? { y: "100%" } : { opacity: 0, scale: 0.97 }}
        animate={isMobile ? { y: 0 } : { opacity: 1, scale: 1 }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }}
        drag={isMobile ? "y" : false}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={isMobile ? handleDragEnd : undefined}
        className={`relative w-full bg-white shadow-2xl rounded-t-3xl sm:rounded-3xl ${panelClassName}`}
      >
        <div
          className="flex justify-center pt-2.5 pb-2 shrink-0 sm:hidden touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="h-1.5 w-10 rounded-full bg-gray-300" aria-hidden="true" />
        </div>
        {children}
      </motion.div>
    </div>
  );
}

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { fadeUp } from "./motion.js";

/** The one error banner used everywhere a request fails — DRYs up the ~10 duplicated inline error-note blocks. */
export function ErrorNote({ title = "Something went wrong", children }: { title?: string; children: ReactNode }) {
  return (
    <motion.div className="error-note" role="alert" variants={fadeUp} initial="hidden" animate="show">
      <AlertTriangle size={17} aria-hidden="true" />
      <span className="error-note__body">
        <strong className="error-note__title">{title}</strong>
        {children}
      </span>
    </motion.div>
  );
}

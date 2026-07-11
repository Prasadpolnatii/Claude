import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { pageTransition } from "./motion.js";

/** Wraps a tab's content so switching sections fades/lifts in instead of hard-cutting. Pair with AnimatePresence + a `key`. */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={pageTransition} initial="hidden" animate="show" exit="exit">
      {children}
    </motion.div>
  );
}

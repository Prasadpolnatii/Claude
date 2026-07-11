import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { fadeUp } from "./motion.js";

/** Consistent "nothing here" state — icon, message, and an optional action, instead of a bare muted line. */
export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div className="empty-state" variants={fadeUp} initial="hidden" animate="show" role="status">
      <span className="empty-state__icon">{icon}</span>
      <span className="empty-state__title">{title}</span>
      {description && <span className="empty-state__desc">{description}</span>}
      {action}
    </motion.div>
  );
}

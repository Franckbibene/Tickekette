import { Router } from 'express';
import { requireAuth } from '../../auth.js';
import { eventsRouter } from './events.js';
import { exportsRouter } from './exports.js';
import { statsRouter } from './stats.js';
import { teamRouter } from './team.js';
import { transfersRouter } from './transfers.js';

// Espace organisateur : réservé aux admins d'un collectif, vérifié côté serveur sur chaque route.
export const adminRouter = Router();
adminRouter.use(requireAuth('admin'));
adminRouter.use('/events', eventsRouter);
adminRouter.use('/events', statsRouter);
adminRouter.use(exportsRouter);
adminRouter.use(transfersRouter);
adminRouter.use(teamRouter);

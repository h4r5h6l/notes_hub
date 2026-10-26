import { Router } from 'express';
import mongoose from 'mongoose';
import { Name } from '../models/Name.js';

export const namesRouter = Router();

// Express 5 forwards rejected promises to the error middleware automatically.
// These helpers turn the two common Mongoose failures into proper 4xx errors.
function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function assertValidId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw badRequest('id is not a valid identifier');
  }
}

// READ — list every name, newest first.
namesRouter.get('/', async (_req, res) => {
  const names = await Name.find().sort({ createdAt: -1 });
  res.json(names);
});

// CREATE — add one name.
namesRouter.post('/', async (req, res) => {
  if (typeof req.body?.name !== 'string' || req.body.name.trim() === '') {
    throw badRequest('name is required');
  }

  const name = await Name.create({ name: req.body.name });
  res.status(201).json(name);
});

// UPDATE — rename one entry.
namesRouter.put('/:id', async (req, res) => {
  assertValidId(req.params.id);

  if (typeof req.body?.name !== 'string' || req.body.name.trim() === '') {
    throw badRequest('name is required');
  }

  const name = await Name.findByIdAndUpdate(
    req.params.id,
    { name: req.body.name },
    { new: true, runValidators: true }
  );

  if (!name) {
    return res.status(404).json({ error: 'name not found' });
  }

  res.json(name);
});

// DELETE — remove one entry.
namesRouter.delete('/:id', async (req, res) => {
  assertValidId(req.params.id);

  const name = await Name.findByIdAndDelete(req.params.id);

  if (!name) {
    return res.status(404).json({ error: 'name not found' });
  }

  res.status(204).end();
});

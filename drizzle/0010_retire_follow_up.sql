-- The Follow-up status was retired; leads in it move to Contacted (their next-contact date stays).
UPDATE "leads" SET "status" = 'contacted' WHERE "status" = 'follow_up';

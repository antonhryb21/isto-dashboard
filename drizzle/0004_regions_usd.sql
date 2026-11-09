-- EU and Romania report in US dollars instead of euros.
UPDATE "regions" SET "currency" = 'USD' WHERE "currency" = 'EUR';

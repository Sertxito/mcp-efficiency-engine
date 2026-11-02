SELECT id, score FROM customers
WHERE :last_score IS NULL OR score < :last_score
ORDER BY score DESC
LIMIT :limit;

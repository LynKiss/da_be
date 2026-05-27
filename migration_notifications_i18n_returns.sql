SET SQL_SAFE_UPDATES = 0;

UPDATE notifications_v2
SET
  title = 'Yêu cầu trả hàng đã được tạo',
  message = REPLACE(REPLACE(message, 'Yeu cau tra hang cho don', 'Yêu cầu trả hàng cho đơn'), 'da duoc tiep nhan', 'đã được tiếp nhận'),
  metadata = JSON_SET(
    COALESCE(metadata, JSON_OBJECT()),
    '$.type', 'return_status_changed',
    '$.targetUrl', CONCAT('/client/returns?returnId=', JSON_UNQUOTE(JSON_EXTRACT(COALESCE(metadata, JSON_OBJECT()), '$.returnId')))
  )
WHERE title = 'Yeu cau tra hang da duoc tao';

SET SQL_SAFE_UPDATES = 0;

UPDATE notifications_v2
SET
  title = 'Yêu cầu trả hàng đã cập nhật',
  metadata = JSON_SET(
    COALESCE(metadata, JSON_OBJECT()),
    '$.type', 'return_status_changed',
    '$.targetUrl', CONCAT('/client/returns?returnId=', JSON_UNQUOTE(JSON_EXTRACT(COALESCE(metadata, JSON_OBJECT()), '$.returnId')))
  )
WHERE title = 'Yeu cau tra hang da thay doi trang thai'
   OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(metadata, JSON_OBJECT()), '$.type')) = 'return_status_changed';

SET SQL_SAFE_UPDATES = 1;
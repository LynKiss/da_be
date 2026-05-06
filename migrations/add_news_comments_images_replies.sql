-- Migration: Add image_urls and parent_id to news_comments
-- Run this against database: agri_ecommerce

ALTER TABLE `news_comments`
  ADD COLUMN `parent_id` BIGINT UNSIGNED NULL AFTER `news_id`,
  ADD COLUMN `image_urls` JSON NULL AFTER `content`,
  ADD INDEX `idx_news_comments_parent` (`parent_id`),
  ADD CONSTRAINT `FK_news_comments_parent`
    FOREIGN KEY (`parent_id`) REFERENCES `news_comments` (`comment_id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

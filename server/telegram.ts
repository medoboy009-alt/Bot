import * as cheerio from 'cheerio';
import type { ScrapedPostPreview } from '../src/types.ts';

export interface ChannelScrapeResult {
  username: string;
  title: string;
  posts: ScrapedPostPreview[];
  latestMessageId: number;
}

export function normalizeChannelUsername(input: string): string {
  let clean = input.trim();
  clean = clean.replace(/^https?:\/\//i, '');
  clean = clean.replace(/^(www\.)?(t\.me|telegram\.me)\//i, '');
  if (clean.startsWith('s/')) {
    clean = clean.slice(2);
  }
  clean = clean.replace(/^@/, '');
  // Strip any trailing slash or post ID like channel/1234
  const slashIdx = clean.indexOf('/');
  if (slashIdx !== -1) {
    clean = clean.slice(0, slashIdx);
  }
  const queryIdx = clean.indexOf('?');
  if (queryIdx !== -1) {
    clean = clean.slice(0, queryIdx);
  }
  return clean.trim();
}

export async function scrapePublicChannel(
  rawUsername: string
): Promise<ChannelScrapeResult> {
  const username = normalizeChannelUsername(rawUsername);
  if (!username || !/^[a-zA-Z0-9_]{3,64}$/.test(username)) {
    throw new Error(
      'اسم قناة التليجرام غير صالح. استخدم اسم المستخدم مثل @channel_name أو رابط t.me/channel_name.'
    );
  }

  const url = `https://t.me/s/${encodeURIComponent(username)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`تعذر الوصول لصفحة القناة العامة (HTTP ${response.status}).`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const errorBlock = $('.tgme_page_icon_error').length > 0;
  const headerTitle = $('.tgme_channel_info_header_title').text().trim();

  if (errorBlock || (!headerTitle && $('.tgme_widget_message').length === 0)) {
    throw new Error(
      `القناة @${username} غير متاحة للمعاينة العامة أو قد تكون قناة خاصة/مجموعة مغلقة.`
    );
  }

  const posts: ScrapedPostPreview[] = [];
  let latestMessageId = 0;

  $('.tgme_widget_message_wrap .tgme_widget_message').each((_, el) => {
    const node = $(el);
    const dataPost = node.attr('data-post') ?? '';
    const parts = dataPost.split('/');
    const msgId = Number.parseInt(parts[1] ?? '0', 10);
    if (!Number.isFinite(msgId) || msgId <= 0) {
      return;
    }

    if (msgId > latestMessageId) {
      latestMessageId = msgId;
    }

    // Exclude quoted reply previews and link previews so reply updates (e.g. "Target Hit") never re-trigger an older quoted signal
    const textContainer = node
      .find('.tgme_widget_message_text')
      .filter(
        (_, tEl) =>
          $(tEl).closest(
            '.tgme_widget_message_reply, .tgme_widget_message_link_preview'
          ).length === 0
      )
      .first();
    if (textContainer.length === 0) {
      return;
    }

    // Preserve line breaks from <br> tags before extracting text
    textContainer.find('br').replaceWith('\n');
    const text = textContainer.text().replace(/\u00a0/g, ' ').trim();
    if (!text) {
      return;
    }

    const timeEl = node.find('time[datetime]').first();
    const postedAt = timeEl.attr('datetime') ?? new Date().toISOString();

    posts.push({
      messageId: msgId,
      text,
      postedAt,
    });
  });

  // Sort ascending by messageId so newest is last
  posts.sort((a, b) => a.messageId - b.messageId);

  return {
    username,
    title: headerTitle || `@${username}`,
    posts,
    latestMessageId,
  };
}

import { inngest } from "../../lib/inngest.js";
import prisma from "../../lib/prisma.js";
import Parser from "rss-parser";
import { Anthropic } from "@anthropic-ai/sdk";
const parser = new Parser();
import { MailService } from "../../services/mail-service.js";
import { sendSms } from "../../services/sms.service.js";
import crypto from "crypto";

/**
 * News Scraping Agent (SW-NEWS)
 * Runs daily to fetch, summarize, and distribute housing market news.
 */
export const scrapeNews = inngest.createFunction(
  { 
    id: "scrape-housing-news", 
    name: "Scrape Housing News & Distribute",
    triggers: [{ cron: "0 9 * * *" }] // Run daily at 9:00 AM UTC
  },
  async ({ event, step }) => {
    // 1. Fetch News from Google News RSS
    const articles = await step.run("fetch-rss-news", async () => {
      try {
        const feed = await parser.parseURL("https://news.google.com/rss/search?q=housing+market+real+estate&hl=en-US&gl=US&ceid=US:en");
        // Get top 3 articles to process
        return feed.items.slice(0, 3).map(item => ({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          contentSnippet: item.contentSnippet,
        }));
      } catch (error) {
        console.error("Failed to fetch RSS:", error);
        return [];
      }
    });

    if (!articles || articles.length === 0) {
      return { message: "No news fetched." };
    }

    const processedNews = [];

    // Process each article
    for (const article of articles) {
      // 2. Check if we already scraped this article (by URL or similar title)
      // Since Google News URLs change, we use a hash of the title
      const titleHash = crypto.createHash("md5").update(article.title).digest("hex");
      
      const isDuplicate = await step.run(`check-duplicate-${titleHash}`, async () => {
        const existing = await prisma.scrapedNews.findFirst({
          where: { title: article.title }
        });
        return !!existing;
      });

      if (isDuplicate) continue;

      // 3. Summarize with Claude
      const summary = await step.run(`summarize-${titleHash}`, async () => {
        if (!process.env.ANTHROPIC_API_KEY) {
           return article.contentSnippet || "No summary available.";
        }
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        try {
          const response = await anthropic.messages.create({
            model: "claude-3-haiku-20240307",
            max_tokens: 300,
            system: "You are an expert real estate content marketer. You rewrite news snippets into engaging, 2-3 sentence summaries that are easy to read for homeowners and leads. Always maintain a professional, helpful tone.",
            messages: [
              {
                role: "user",
                content: `Title: ${article.title}\nSnippet: ${article.contentSnippet}\n\nPlease write a short, engaging summary of this news.`
              }
            ]
          });
          return response.content[0].text;
        } catch (error) {
          console.error("Summarization failed:", error);
          return article.contentSnippet || "No summary available.";
        }
      });

      // 4. Save to Database
      const savedArticle = await step.run(`save-article-${titleHash}`, async () => {
        // Find companies that have sales enabled
        const companies = await prisma.company.findMany({
          where: { salesEnabled: true }
        });

        const createdItems = [];
        for (const company of companies) {
          const news = await prisma.scrapedNews.create({
            data: {
              companyId: company.id,
              title: article.title,
              originalUrl: article.link,
              summary: summary,
              source: "Google News",
              publishedAt: new Date(article.pubDate || new Date()),
              wasBroadcasted: false
            }
          });
          createdItems.push(news);
        }
        return createdItems;
      });
      
      if (savedArticle.length > 0) {
        processedNews.push(savedArticle);
      }
    }

    // 5. Distribute as Campaign to Leads
    if (processedNews.length > 0) {
      await step.run("distribute-news", async () => {
        const companies = await prisma.company.findMany({
          where: { salesEnabled: true },
          include: { integrations: true }
        });

        for (const company of companies) {
          // Get new articles for this company that weren't broadcasted
          const newArticles = await prisma.scrapedNews.findMany({
            where: { companyId: company.id, wasBroadcasted: false }
          });

          if (newArticles.length === 0) continue;

          // Get opted-in leads
          const leads = await prisma.lead.findMany({
            where: { companyId: company.id, OR: [{ emailOptIn: true }, { smsOptIn: true }] }
          });

          if (leads.length === 0) {
             // Mark as broadcasted anyway to prevent piling up
             for (const article of newArticles) {
               await prisma.scrapedNews.update({
                 where: { id: article.id },
                 data: { wasBroadcasted: true }
               });
             }
             continue;
          }

          // Combine articles into a single digest or just take the first one
          const topArticle = newArticles[0];
          
          const emailSubject = `Housing Market Update: ${topArticle.title}`;
          const emailBody = `
            <h2>Housing Market Update</h2>
            <p>${topArticle.summary}</p>
            <p><a href="${topArticle.originalUrl}">Read more here</a></p>
          `;
          
          const smsBody = `Housing Update: ${topArticle.title} - ${topArticle.summary.substring(0, 100)}... Read more: ${topArticle.originalUrl}`;

          for (const lead of leads) {
            try {
              if (lead.emailOptIn && lead.email) {
                await MailService.sendEmail({
                  companyId: company.id,
                  to: lead.email,
                  subject: emailSubject,
                  html: emailBody
                });
                
                await prisma.leadTimeline.create({
                  data: {
                    leadId: lead.id,
                    type: "EMAIL_SENT",
                    description: `Sent News Update: ${topArticle.title}`
                  }
                });
              }

              if (lead.smsOptIn && lead.phone) {
                await sendSms({
                  to: lead.phone, 
                  body: smsBody,
                  // smsConfig might be needed if resolving per-company, or tag
                  tag: "news-scraper"
                });
                
                await prisma.leadTimeline.create({
                  data: {
                    leadId: lead.id,
                    type: "SMS_SENT",
                    description: `Sent News Update SMS: ${topArticle.title}`
                  }
                });
              }
            } catch (err) {
              console.error(`Failed to send news to lead ${lead.id}:`, err);
            }
          }

          // Mark as broadcasted
          for (const article of newArticles) {
            await prisma.scrapedNews.update({
              where: { id: article.id },
              data: { wasBroadcasted: true }
            });
          }
        }
      });
    }

    return { processed: processedNews.length };
  }
);
